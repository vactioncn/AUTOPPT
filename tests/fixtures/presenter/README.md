# Presenter test media

The avatar is an original synthetic SVG-style face, rasterized to PNG for upload validation. The MP4 is a 256 × 256, 2-second H.264/AAC fixture with a simple animated mouth and 440 Hz tone. It contains no real person's likeness, user narration or provider output.

Tests read the committed fixture; AutoPPT has no ffmpeg runtime dependency. Maintainers can optionally rebuild this test-only clip from avatar.png:

    ffmpeg -loop 1 -i avatar.png -f lavfi -i sine=frequency=440:sample_rate=44100 -t 2 -vf "drawbox=x=113:y=152:w=30:h=8:color=0xa75d50:t=fill:enable='lt(mod(t,0.4),0.2)'" -c:v libx264 -pix_fmt yuv420p -r 10 -c:a aac -b:a 32k -movflags +faststart -map_metadata -1 presenter.mp4

The mock adapter returns these same bytes deterministically and never claims lip synchronization. It is only selected when both NODE_ENV=test and AUTOPPT_PRESENTER_TEST=1; production has no mock selector.
