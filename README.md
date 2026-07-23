# 🎯 Arabic Trivia

A Kahoot-style multiplayer trivia game in Arabic. Stream the host screen on a TV, players join with their phones by scanning a QR code.

- **One Node process.** Static files + WebSocket + server-side QR. No build step, no bundler, no database.
- **Pure web tech.** HTML/CSS/JS. Works in any modern browser, including phone browsers.
- **Hot-reload questions.** Edit `questions.json` while the server is running — it reloads automatically.
- **RTL-first.** The whole UI is built for Arabic.
- **Agent-friendly MCQ.** The questions file is a clean JSON schema designed to be authored by a coding agent (or by you).

---

## Quick start

```bash
# 1. install (only needs `ws` + `qrcode`)
npm install

# 2. run
npm start
```

You'll see something like:

```
🎮  Arabic Trivia
────
   TV / Host :  http://192.168.1.5:3000/host
   Players   :  http://192.168.1.5:3000/
   Game code :  K7P2
────
   Tip: open the TV URL on the big screen, then scan the QR with phones.
```

1. Open the **TV / Host** URL on the big screen (laptop → HDMI, Apple TV, smart TV, Chromecast, etc.).
2. Players scan the **QR** on the TV with their phone camera.
3. Players enter a name → they appear on the TV.
4. Hit **▶ ابدأ اللعبة** on the host.

> ⚠️ Make sure the TV, the host laptop, and all the phones are on the **same Wi-Fi network**. The host URL shows your LAN IP — that's the address phones need to reach.

To change the port: `PORT=8080 npm start`.
To use a different questions file: `QUESTIONS_FILE=./my-quiz.json npm start`.

---

## File layout

```
arabic-trivia/
├── server.js          # one file: HTTP + WebSocket + QR
├── package.json
├── questions.json     # ← edit this to change the quiz
├── README.md
└── public/
    ├── host.html      # TV / host display
    ├── player.html    # phone player UI
    └── styles.css     # shared styles
```

---

## How to add questions (the agent part)

The quiz is a single JSON file. Edit `questions.json` — the server hot-reloads it within a second. Add as many questions as you want (10 is a good party length; 30+ is fine too).

### Schema

```jsonc
{
  "meta": {
    "title": "لعبة المعلومات",          // shown on the TV lobby
    "subtitle": "اختبر معلوماتك"        // optional, shown under the title
  },
  "settings": {
    "timePerQuestion": 20,              // seconds per question
    "showCorrectAnswer": true           // (reserved for future use)
  },
  "questions": [
    {
      "question": "ما هي عاصمة مصر؟",
      "choices": [
        { "text": "القاهرة",      "correct": true  },
        { "text": "الإسكندرية",   "correct": false },
        { "text": "الأقصر",       "correct": false },
        { "text": "أسوان",        "correct": false }
      ]
    }
  ]
}
```

**Rules the server enforces on load** (you'll get a clear error in the terminal if you break them):

- Each question must have **2 to 6 choices**.
- Each question must have **exactly one** choice with `"correct": true`.
- Question text and choice text are trimmed strings.

### Adding questions with an agent 🤖

The easiest way to extend the quiz is to ask your agent (Mavis) to do it. Just paste this into a new turn:

> Here are the existing questions in `questions.json`:
>
> <paste the current questions.json>
>
> Add **20 more questions** in Arabic about **modern Arab history (1900–present)**. Mix difficulty: 8 easy, 8 medium, 4 hard. Keep wording clear and short. 4 choices each, exactly one correct. Only modify the `questions` array — don't touch `meta` or `settings`. Make sure every question has a verifiable correct answer.

**Tips for great agent prompts:**

| Goal                | What to add to the prompt                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Specific topic      | "about the Arab Spring", "about the Saudi Pro League", "about Quran surahs"                                                         |
| Difficulty mix      | "5 easy (well-known facts), 5 medium (requires some knowledge), 3 hard (trivia buffs only)"                                          |
| Source-bound        | "use only facts from Wikipedia's [list of …]"                                                                                        |
| Avoid trap choices  | "make wrong answers plausible but clearly wrong — no 'all of the above' or joke answers"                                              |
| Length              | "keep each question under 80 characters"                                                                                             |
| Tonal match         | "use Modern Standard Arabic (فصحى), not colloquial"                                                                                  |
| Replace vs. add     | "add 20 questions to the existing list" vs. "**replace** all questions with…"                                                       |
| Topic rotation      | "alternate topics so two questions in a row aren't from the same category"                                                           |

**Other things you can ask the agent:**

- *"Group these questions by category and tell me the distribution."*
- *"Find any question whose correct answer is ambiguous and fix it."*
- *"Reorder the questions so the hardest ones are last."*
- *"Add a 5th choice (harder) to 3 questions to use the 2–6 choice range."*
- *"Translate these 10 English questions to Arabic and add them."*

---

## Game flow

1. **Lobby** — TV shows the QR code, join URL, and a live list of joined players.
2. **Question** — TV shows the question + 4 colored options + countdown. Players tap on their phone.
3. **Reveal** — TV highlights the correct answer, shows how many picked each option. Players see ✓/✗ on their phone.
4. **Leaderboard** — TV shows the top 5. Players see their current rank.
5. **Repeat** for each question.
6. **Final podium** — TV shows 🥇🥈🥉 and the full ranking. Players see their final rank.

**Scoring:** correct answer = up to 1000 points, weighted by speed (full points if you answer in the first second, 0 if you wait until the timer expires).

---

## Customizing the look

Colors live at the top of `public/styles.css` as CSS custom properties:

```css
--c-a: #e21b3c;   /* red  — choice A */
--c-b: #1368ce;   /* blue — choice B */
--c-c: #d89e00;   /* yellow — choice C */
--c-d: #26890c;   /* green — choice D */
```

Change them to match your party theme. The buttons on phones and the choice cards on TV both use the same tokens.

The whole layout is fluid (uses `vmin`/`vmax`), so it works on any TV aspect ratio and on portrait phones.

---

## Troubleshooting

- **Phone can't reach the server.** Make sure the phone is on the same Wi-Fi. Some networks (guest networks, mobile hotspots with isolation) block device-to-device traffic.
- **QR doesn't scan.** Type the URL manually on the phone — it's shown under the QR.
- **WebSocket keeps reconnecting.** Same Wi-Fi issue, or a firewall blocking port 3000.
- **"شاشة المضيف مشغولة بالفعل" on the TV.** A previous host session is still connected. Restart the server (`Ctrl-C` then `npm start`).
- **Questions not changing after edit.** The server watches the file with a 1s debounce. Wait a beat, then hit the host URL again.
- **Want to wipe state for a new game night?** Just hit the "🔄 لعبة جديدة" button on the final podium, or restart the server.

---

## License

MIT.
