# Native-speaker audio replies

Record short clips (OGG/Opus, mono, < 20 s) with a native speaker for each language and save them as
`audio/<lang>/<key>.ogg`. When a file exists, RidePass sends it alongside the text message — riders who
read slowly can simply listen. Keys currently wired: `consent`, `ask_name`, `ready`.

Languages: `en`, `pcm` (Pidgin), `ha`, `yo`, `ig`. Tip: record on WhatsApp, export, convert with
`ffmpeg -i in.opus -c:a libopus -b:a 24k -ac 1 out.ogg`.
