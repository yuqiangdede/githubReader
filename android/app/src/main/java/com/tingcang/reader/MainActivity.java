package com.tingcang.reader;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GitHubPlugin.class);
        registerPlugin(ReaderTtsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
