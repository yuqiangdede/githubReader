package com.tingcang.reader;

import java.net.URI;

final class GitHubPaths {
    static boolean allowed(String value) {
        try {
            URI uri = new URI(value);
            if (uri.isAbsolute() || uri.getRawAuthority() != null || uri.getFragment() != null) return false;
            for (String segment : uri.getPath().split("/")) if (segment.equals(".") || segment.equals("..")) return false;
            return value.matches("/repos/[\\w.-]+/[\\w.-]+(?:/contents(?:/[^?#]*)?|/branches)?(?:\\?[^#]*)?") || value.equals("/user") || value.equals("/user/repos?per_page=100&sort=updated");
        } catch (Exception e) { return false; }
    }
}
