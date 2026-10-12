# <img src="app/icon.svg" width="36" height="36" alt=""> Transyt

[中文](README.zh.md)

Turn a YouTube video or a local file into a subtitled video on your own computer, and keep the Chinese and English subtitles, transcripts, and vocabulary so you can study with the picture.

Transcription runs locally with Whisper. The audio is not sent anywhere else. Translation uses the API you configure. Jobs, videos, and API keys stay in the local `data/` directory, which is listed in `.gitignore`.

## What it does

- Download a YouTube video, or upload a local file (mp4, mov, mkv, webm, m4v, up to 2GB)
- Extract the audio, transcribe it with word-level timestamps, then split it on sentences and pauses
- Translate the source into Chinese. Subtitles can be Chinese only, English only, or bilingual
- For bilingual subtitles, put Chinese or English on top. Each language stays on its own line, with its own size and color
- Burn the subtitles into the picture, or produce a transcript only
- Study beside the video: read subtitles, extract vocabulary, and save sentences and words
- Organize projects in folders and search old videos by title

Only one job runs at a time. Later submissions wait in a queue. If the dev server or the production process restarts, a running job is interrupted. Once transcription has written `cues.json`, you can continue with translation and burning.

## What one job does

1. **Download or import.** YouTube videos are downloaded with `yt-dlp`. Local files are stored as they are. If a proxy is needed, the download uses the proxy set under Translation API.
2. **Extract audio.** ffmpeg pulls the audio track for transcription.
3. **Transcribe.** Local Whisper produces a timestamped transcript. The precise model is about 1.5GB on first download. The fast model is smaller. Source language can be auto-detect, English, Japanese, Korean, French, Spanish, German, or Chinese.
4. **Translate.** For a non-Chinese video, each subtitle line is translated into Chinese, 12 lines per request, with up to 3 requests in flight. A detected Chinese source skips translation and uses the original text as Chinese. If you chose English-only subtitles but the source is Chinese, there is no English to burn, so the job falls back to Chinese only.
5. **Burn.** With “burn into the video” and a picture track, ffmpeg with libass burns the subtitles in. “Transcript only”, or a file with no picture, skips this step.
6. **Transcript.** Writes a Chinese Markdown transcript. When the source is not Chinese, it also keeps a source transcript.

Chinese lines drop trailing punctuation and stay on one line. Bilingual cues place one language above the other and share the same timestamps.

## Interface

The home page puts the job form on the left and the current job, downloads, and recent list on the right. Clicking **TRANSYT** at the top left returns home and clears the form for this run. The saved translation API and key stay in place.

![Home: processing options on the left, the finished video, downloads, and recent jobs on the right](docs/home.png)

The recent list shows 8 jobs per page. Page controls appear only after the ninth job.

### Subtitle style

| Option | What gets burned | Size and color |
| --- | --- | --- |
| Chinese only | Chinese only | Chinese size and color |
| English only | The English source only | English size and color |
| Bilingual | One line of each | Both pairs, and a choice of which language is on top |

Defaults are Chinese at size 20 in white, and English at size 16 in pale yellow. Sizes run from 12 to 64. These choices are stored locally and kept for the next visit.

### Study mode

After a job with video finishes, you can enter study mode. The picture stays on the left. Subtitles, vocabulary, and saved items stay on the right.

![Study mode: video on the left, vocabulary extracted by level on the right](docs/study.jpg)

- **Subtitles.** Click a line to jump to that time. The star saves the sentence.
- **Vocabulary.** Choose a CEFR range from A1 to C2, and the kinds you want: words, phrases, collocations, idioms, slang, and usage. Then extract. Each item includes a short Chinese gloss and IPA. If nothing in the source reaches the chosen range, the list stays empty instead of filling in easier items. Click a word to jump to its time, use the speaker for a system voice, and click the source sentence to translate it into Chinese.
- **Saved.** Sentences and words saved from this video.

Pronunciation uses the browser’s system voices. The word is not uploaded. Local voices on a Mac work offline.

Saved items in project management collect sentences and words from every video. Opening one jumps into study mode for that video.

### Projects

- **Projects.** Filter by folder and search by title. Search applies together with the current folder.
- **Folders.** Create and delete folders. Deleting a folder sends its projects back to uncategorized.
- Opening a project returns to the home page. Deleting a project also deletes its downloaded video and subtitles. If the same YouTube video was processed more than once, those runs are removed together.

## Requirements

Node.js 18.18 or newer.

These commands need to be available in the terminal on either system:

| Command | Use |
| --- | --- |
| `ffmpeg`, `ffprobe` | Extract audio and burn subtitles. ffmpeg must include libass |
| `yt-dlp` | Download YouTube videos |
| `python3` or `python` | Run the transcription script. `python3` is tried first, then `python` |

Install one transcription library. MLX is used when it is already installed:

| System | Library | Precise model | Fast model |
| --- | --- | --- | --- |
| Apple silicon Mac | `mlx-whisper` | `mlx-community/whisper-large-v3-turbo` | `mlx-community/whisper-medium-mlx` |
| Windows, and other machines without MLX | `faster-whisper` | `large-v3-turbo` | `medium` |

The two model downloads are not interchangeable. Switching machines or engines downloads the model again.

Burned subtitles use PingFang on macOS and Microsoft YaHei on Windows.

### Mac

```bash
brew install ffmpeg yt-dlp
pip3 install mlx-whisper
```

If the installed ffmpeg cannot burn subtitles, an Apple silicon Mac downloads a libass-enabled ffmpeg into `data/bin/`.

### Windows

Install Python, a full ffmpeg build that includes libass (both `ffmpeg` and `ffprobe`), and `yt-dlp`. Make sure they are on `PATH`. Then:

```bash
pip install faster-whisper
```

Windows does not download ffmpeg for you. Pausing a job uses `taskkill` to stop the transcription or burn process.

Do not copy `node_modules` from a Mac to Windows. Run `npm install` again in the project directory on the other system.

## Download and start

```bash
git clone https://github.com/knowledgefxg/Transyt.git
cd Transyt
npm install
npm run dev
```

You can also download the ZIP from the GitHub repository, unzip it, and run the last two commands in that folder. The repository does not include `node_modules`, videos, or API keys.

Open [http://localhost:3000](http://localhost:3000).

If the top of the page says ffmpeg, yt-dlp, or Whisper is missing, install that tool and refresh.

For production:

```bash
npm run build
npm start
```

## Translation API

Translation API, at the top right, stores one configuration shared by subtitle translation and vocabulary extraction. It is written to `data/settings.json`. The app is not tied to one provider. Any service with an OpenAI-compatible Chat Completions API works, including official APIs, gateways, and a local compatible server.

![Translation API: base URL, model name, API key, and download proxy](docs/settings.png)

Requests are `POST` with an `Authorization: Bearer <key>` header and a body that includes `model`, `temperature: 0.2`, and `messages`. Subtitle translation asks the model to return JSON, one item per source line. Vocabulary extraction uses the same settings to pick words, phrases, collocations, idioms, slang, and usage from the source.

### The four fields

| Field | How to fill it |
| --- | --- |
| Base URL | The API root from the provider’s docs, usually ending in `/v1`, such as `https://api.openai.com/v1`. The app appends `/chat/completions`. If the docs already give a full `.../chat/completions` URL, paste that as-is and it will not be appended twice |
| Model | The model ID available at that URL, such as `gpt-4o-mini`, `deepseek-chat`, or `qwen-plus`. Do not put the API key here |
| API key | The key issued by the provider. After a key is saved, leaving this box empty and saving again keeps the old key. The page never shows the key back. If an `sk-` key is entered in the model field by mistake, saving moves it into the key field. When the base URL contains DeepSeek, the model becomes `deepseek-chat`; otherwise it becomes `gpt-4o-mini` |
| Download proxy | Used only for YouTube downloads. Leave it empty if you do not need one. Translation requests do not use this proxy. A typical value is `http://127.0.0.1:7890` |

The base URL, model, and key have to succeed together as one chat request. When you change providers, change all three. Changing only the model and keeping the old URL often returns 404 or “model not found”.

If you start a job before a key is saved, the transcript is kept. After you add a key, translation and burning can continue. Vocabulary extraction in study mode uses this same configuration.

The rows below are common examples, not a support list. Follow the docs for the service you use:

| Service | Base URL | Example model |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Qwen (compatible mode) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Local server or gateway | The root URL from its docs | A model ID that service lists |

## Output

Each job is stored in `data/jobs/<id>/`. The id is 16 hexadecimal characters. Common files:

| File | Contents |
| --- | --- |
| `video.mp4` | The downloaded or imported source video |
| `burned.mp4` | The video with subtitles burned in |
| `zh.srt` | Chinese subtitles |
| `en.srt` | English subtitles, written when the source is not Chinese, with the same timestamps as the Chinese file |
| `subs.ass` | The subtitle file actually used for burning |
| `source.srt` | The transcript with its original timestamps |
| `transcript-zh.md` | Chinese transcript |
| `transcript-src.md` | Source transcript, written when the source is not Chinese |
| `lexicon.json` | Vocabulary extracted by level. Created when you extract it in study mode |
| `cues.json` | Segments and timestamps. With this file, the job can resume at translation |
| `job.json` | Status, options, and stages for this job |

The finished video, subtitles, and transcripts can be downloaded from the home page and from project management.

## Pause, failure, and resume

You can pause while a job is running. Pausing stops the current download, transcription, or burn.

If translation fails partway, or a restart interrupts the job after transcription has finished, the page offers to continue translation and burning. Lines that are already translated are kept. Missing lines are requested again.

A job that is still running cannot be deleted. Wait until it finishes or pause it first.

## Development

Check subtitle segmentation:

```bash
npm run test:segment
```
