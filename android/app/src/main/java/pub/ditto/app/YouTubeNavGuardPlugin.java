package pub.ditto.app;

import android.net.Uri;
import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Drops top-level WebView navigations to YouTube domains so the embedded
 * iframe can never hand off to the YouTube app or browser. The visible YT
 * chrome (logo, "Watch on YouTube", channel name, related videos) is already
 * defanged at the browser layer by the iframe sandbox in YouTubeEmbed.tsx;
 * this plugin closes the long-press / context-menu intent path that sandbox
 * cannot reach.
 */
@CapacitorPlugin(name = "YouTubeNavGuard")
public class YouTubeNavGuardPlugin extends Plugin {

    private static final String TAG = "YTNavGuard";

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        if (url == null) return null;
        String host = url.getHost();
        if (host == null) return null;
        host = host.toLowerCase();

        if (host.equals("youtube.com")
                || host.endsWith(".youtube.com")
                || host.equals("youtu.be")
                || host.equals("youtube-nocookie.com")
                || host.endsWith(".youtube-nocookie.com")) {
            Log.d(TAG, "Blocked top-level navigation to " + host);
            return true;
        }

        return null;
    }
}
