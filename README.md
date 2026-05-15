# Rubber Duck 2.0

A Socratic debugger that never gives you the answer.

## Run locally

Create `.env.local`:

```txt
ANTHROPIC_API_KEY=sk-ant-your-key-here
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

Then run:

```bash
npm start
```

Open:

```txt
http://localhost:3001
```

## How it works

- Exchanges 1-7: pure Socratic questions only
- Exchanges 8-10: warmer, more pointed hints
- Say "found it" to trigger debrief mode
- Say "just tell me" after exchange 10 to trigger reveal mode

## GitHub

Suggested repository:

```txt
https://github.com/Sathvika-g-29/RubberDuck2.0
```

Suggested branch:

```txt
feature/ai-backend
```

Do not commit `.env.local`; it contains your Anthropic API key.
