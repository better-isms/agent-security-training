# Renders assets/demo/demo.gif from the recorded run. From the repo root:
#   vhs assets/demo/demo.tape
Output assets/demo/demo.gif
Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 14
Set Width 1100
Set Height 760
Set Padding 28
Set Framerate 12
Set PlaybackSpeed 1.0
Set TypingSpeed 0ms
Set Theme { "name": "uas", "background": "#0a2540", "foreground": "#e8eef6", "cursor": "#0a2540", "selection": "#24507f", "black": "#0a2540", "red": "#f87171", "green": "#6ee7b7", "yellow": "#fbbf24", "blue": "#93c5fd", "magenta": "#c4b5fd", "cyan": "#7dd3fc", "white": "#e8eef6", "brightBlack": "#8fa3bf", "brightRed": "#fca5a5", "brightGreen": "#a7f3d0", "brightYellow": "#fde68a", "brightBlue": "#bfdbfe", "brightMagenta": "#ddd6fe", "brightCyan": "#bae6fd", "brightWhite": "#ffffff" }
Hide
Type "clear && node assets/demo/replay.mjs" Enter
Sleep 0.5s
Show
Sleep 14s
