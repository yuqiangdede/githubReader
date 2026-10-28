import { existsSync } from 'node:fs';
import { readdir, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
const root = path.resolve('.');
let javaHome = process.env.JAVA_HOME;
if (existsSync('.tooling/java')) {
  const dirs = await readdir('.tooling/java');
  const bundled = dirs.find(name => existsSync(path.join('.tooling/java', name, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')));
  if (bundled) javaHome = path.join(root, '.tooling/java', bundled);
}
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (existsSync('.tooling/android-sdk') ? path.join(root, '.tooling/android-sdk') : '');
if (!javaHome || !sdk) throw new Error('需要 JDK 21 和 Android SDK 35，请设置 JAVA_HOME 和 ANDROID_HOME，参见 README。');
await writeFile('android/local.properties', `sdk.dir=${sdk.replaceAll('\\', '/').replaceAll(':', '\\:')}\n`);
const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, PATH: path.join(javaHome, 'bin') + path.delimiter + process.env.PATH };
const args = process.argv.slice(2);
const command = process.platform === 'win32' ? 'cmd.exe' : './gradlew';
const localGradle = path.join(root, '.tooling/gradle/gradle-8.11.1/bin', process.platform === 'win32' ? 'gradle.bat' : 'gradle');
const gradleArgs = args.length ? args : [':app:assembleDebug', ':app:testDebugUnitTest'];
if (existsSync('.tooling/mirrors.init.gradle')) gradleArgs.push('-I', path.join(root, '.tooling/mirrors.init.gradle'));
const executable = existsSync(localGradle) ? localGradle : (process.platform === 'win32' ? 'gradlew.bat' : './gradlew');
const child = spawn(process.platform === 'win32' ? command : executable, process.platform === 'win32' ? ['/d', '/c', executable, ...gradleArgs, '--console=plain'] : [...gradleArgs, '--console=plain'], { cwd: path.join(root, 'android'), env, stdio: 'inherit' });
const code = await new Promise(resolve => child.on('exit', resolve));
if (code !== 0) process.exit(code || 1);
const apk = 'android/app/build/outputs/apk/debug/app-debug.apk';
if (existsSync(apk)) { await mkdir('artifacts', { recursive: true }); await copyFile(apk, 'artifacts/tingcang-debug.apk'); console.log('APK → artifacts/tingcang-debug.apk'); }
