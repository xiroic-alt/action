# Player display investigation

## Black screen regression

The installed a4fee63 build reports this QuickJS link error when opening the
player: "Could not find export 'systemInfo' in module 'systemInfo'".
The native module registers a default export; a native C++ symbol named
YSystemInfoModule::freezeScreen does not establish a JavaScript method.
The failed import and automatic freeze hook have been removed. Version stays
0.9.57. Unrelated layout and following-list changes are preserved.

## Verified freeze behavior

Device sample libjsapi_export.so SHA-256:
c2de844fd0e1c82b9489a5d8bcfaa7ce5e73862c03e7f1ff78eb831dddf73bda

Native call chain: JSGlobalProxy::restartMiniapp schedules an internal callback
at 0x9c50c, which calls YSystemInfoModule::freezeScreen at 0x9c538.
The adapter reaches a HAL callback; applicable HAL branches create
/tmp/.weston_freeze. Weston checks this file at 0x23f9c..0x23ffc and bypasses
normal repaint while it exists.

An animated videotestsrc -> waylandsink pipeline was kept alive across three
2-second weston-debug timeline windows. Before/frozen/restored traces contain
354 / 0 / 380 lines; actual core_repaint_posted events are 36 / 0 / 39.
Removing the owned marker restores compositor activity.
The source remained alive and the marker was absent after cleanup. This is a
repaint freeze, not a video-layer lowering operation.

## Stock player evidence boundaries

The installed stock player package references cvplayer. Its system proxy is
JSCVPlayerProxy (the earlier search for JCVPlayerProxy missed it). In this
firmware sample, pause/resume/stop only log; play and setVideoSurface validate
arguments and log, with no decoder/display call in their function bodies.
A symbol or string pool alone does not prove an active playback path.

Loaded libraries in the shared miniapp process do not identify which app uses
them. KMS state captured without active video does not establish video layer
ordering. Use weston-debug scene-graph and timeline for these claims; retain
physical-display or framebuffer evidence for the actual composed result.
