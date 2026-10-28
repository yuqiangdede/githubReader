package com.tingcang.reader;

import org.junit.Test;
import static org.junit.Assert.*;

public class GitHubPathsTest {
    @Test public void permitsOnlyReadingEndpoints() {
        assertTrue(GitHubPaths.allowed("/repos/yuqiangdede/The-Last-Watch"));
        assertTrue(GitHubPaths.allowed("/repos/a/b/contents/%E7%AC%AC%E4%B8%80%E7%AB%A0.md?ref=main"));
        assertTrue(GitHubPaths.allowed("/repos/a/b/branches"));
        assertTrue(GitHubPaths.allowed("/user/repos?per_page=100&sort=updated"));
        assertFalse(GitHubPaths.allowed("/repos/a/b/issues"));
        assertFalse(GitHubPaths.allowed("/user/emails"));
    }
    @Test public void rejectsExternalOriginsAndTraversal() {
        for (String path : new String[] {"https://evil.example/repos/a/b", "//evil.example/repos/a/b", "/repos/a/b/contents/../../../../user", "/repos/a/b/contents/%2e%2e/%2e%2e/user", "/repos/a/b/contents/x%2f..%2f..%2fuser", "/repos/a/b#fragment", "/repos/a/b/contents/invalid%"}) assertFalse(path, GitHubPaths.allowed(path));
    }
}
