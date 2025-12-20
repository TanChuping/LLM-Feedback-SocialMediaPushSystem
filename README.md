# Explainable LLM-Feedback Recommender (Exploratory Demo)

> An exploratory engineering project built by a student, investigating **how natural-language user feedback can be translated into controllable preference signals** and used to adjust a recommendation feed in real time — without delegating decision-making to a black-box model.

This repository reflects an ongoing learning process rather than a finished system. Design choices are intentionally simple, explicit, and sometimes imperfect, with the goal of understanding engineering trade-offs rather than maximizing performance.

---

## Motivation

Most recommendation systems infer user preferences indirectly from clicks, likes, and dwell time. While effective at scale, these signals:

* are ambiguous and noisy,
* do not capture *why* a user dislikes something,
* can reinforce incorrect assumptions about user intent.

Large language models make it tempting to let AI directly control recommendations. However, this raises practical concerns around:

* controllability and safety,
* over-correction from emotional or noisy feedback,
* lack of debuggability.

This project explores a more conservative design:

> **Use an LLM only as a semantic translator — converting natural-language feedback into structured preference adjustments — while keeping all ranking decisions inside a transparent, rule-based system.**

The emphasis is on engineering clarity, not model sophistication.

---

## High-Level Architecture

In the **current implementation**, the system runs entirely client-side to demonstrate immediate responsiveness and to keep the feedback loop easy to inspect. The architecture is intentionally simple and may evolve over time.

```
Feed UI
  ↓ (like / dislike / free-text feedback)
Client-side Logic (React State)
  ↓
LLM API (semantic parsing only)
  ↓
User Profile Update (in-memory / LocalStorage)
  ↓
Weighted Linear Re-Ranking
  ↓
Updated Feed + Explanation Panels
```

A deliberate constraint:

> **The LLM interprets language; it never decides ranking.**

---

## Ranking Model (Current Version)

The feed is ordered using a **weighted linear scoring model**. To solve the semantic ambiguity of tags (e.g., a "Gaming" tag on a "Party" post), we introduced **Per-Post Tag Weights**.

For each post:

```
score(post) = popularity_bias(post)
            + weighted_interest_reward(user, post)
            − weighted_dislike_penalty(user, post)
            + exploration_noise
```

---

### A. Popularity Bias

A small baseline favoring broadly liked content:

```
popularity_bias = log10(likes + 1) * k_pop
```

* The logarithm smooths extreme head effects.
* Allows newer or niche content to surface.

---

### B. Weighted Interest Reward

We calculate relevance by multiplying the user's interest strength by the tag's importance within the specific post:

```
interest_reward = Σ ( user_interest[tag] * post_tag_relevance * k_like )
```

* **user_interest**: How much the user likes the topic (from profile).
* **post_tag_relevance**: How central the topic is to this specific post (e.g., 2.0 for Core Topic, 0.5 for Vibe).

This distinction ensures that liking "Social" boosts a Nightclub post (Social: 2.5) much more than a Gaming post that happens to have a chat feature (Social: 0.2).

---

### C. Dislike Penalty & Veto Power

Handling dislikes requires nuance. We implemented a **Veto Mechanism** to prevent collateral damage.

```
impact = user_dislike[tag] * post_tag_relevance
```

1. **Standard Penalty**: If `impact` is low, we simply subtract from the score.
2. **Hard Veto**: If `impact > VETO_THRESHOLD`, the post receives a massive penalty (effectively removed).

**Why?**
If a user hates `Gaming` (User Weight 20), we want to ban *League of Legends* posts (Gaming Relevance 2.5 → Impact 50 → **VETO**), but we should NOT ban a generic party post that briefly mentions a console (Gaming Relevance 0.2 → Impact 4 → **Minor Penalty**).

---

### D. Exploration Noise

A small random perturbation:

```
exploration_noise = random() * k_rand
```

* Used only to break ties between similarly scored items.

---

## User Profile Representation

The user profile is a lightweight structure containing:

* positive tag weights (`interests`)
* negative tag weights (`dislikes`)
* optional metadata or coarse user hints

Weights are adjusted incrementally and are not learned from large offline datasets.

---

## Role of the LLM

The LLM is used strictly for **semantic translation**, not ranking.

### Interactive Demo Walkthrough

To observe the system in action:

1.  **Click the "..." (More) button** on the top-right of any post card.
2.  **Select or Type Feedback**: Enter a natural language reason (e.g., *"I'm tired of technical debates, show me something tasty"*).
3.  **Watch the Dashboard**: The "System Internals" panel on the right will log the **LLM Analysis** and show real-time animation of **User Profile** weight updates.
4.  **See the Re-Rank**: The feed will immediately shuffle to prioritize content matching your new interests.

### Example Log (Programming → Food)

Here is a real trace of what happens when a user pivots from Tech topics to Food:

**User feedback event**

```json
{
  "feedback": "无聊的争辩不感兴趣 我更关心每天吃啥",
  "target_post": "Is C++ really harder than Java?"
}
```

**LLM analysis → parameter adjustments** (schema-validated)

```json
{
  "adjustments": [
    {"tag": "🍱 Food", "category": "interest", "delta": 20},
    {"tag": "🍱 Foodie", "category": "interest", "delta": 15},
    {"tag": "🍜 Chinese Food", "category": "interest", "delta": 15},
    {"tag": "🍱 Restaurant Review", "category": "interest", "delta": 15},
    {"tag": "🥦 Groceries", "category": "interest", "delta": 12},
    {"tag": "⚔️ Debate", "category": "dislike", "delta": 15},
    {"tag": "💻 C++", "category": "dislike", "delta": 10},
    {"tag": "☕ Java", "category": "dislike", "delta": 10},
    {"tag": "⌨️ Coding", "category": "dislike", "delta": 8},
    {"tag": "💭 Opinion", "category": "dislike", "delta": 10}
  ],
  "user_note": "User is disinterested in technical comparisons and 'boring' academic debates. They explicitly stated a preference for lifestyle and food-related content."
}
```

**Profile update**

* Interest weights increase for tags like `🍱 Food`, `🍱 Foodie`, `🍱 Restaurant Review`
* Dislike weights increase for tags like `⚔️ Debate`, `💻 C++`, `⌨️ Coding`

### Design Constraints

* Strict JSON schema enforcement
* Parsing failures fall back to a no-op update
* The LLM never emits final scores or rankings

This keeps the system debuggable and limits the blast radius of model errors.

---

## Online Re-Ranking

Whenever the user profile changes:

* scores are recomputed for the current candidate set
* the feed is re-sorted immediately

In the current demo, re-ranking is performed client-side for responsiveness. The same logic could be moved server-side in a future iteration without changing the model.

---

## Explainability

The UI explicitly visualizes:

* current user profile weights
* the most recent LLM parse result
* ranking differences before vs after feedback
* per-item score breakdowns

The intent is to make recommendation behavior understandable rather than impressive.

---

## Known Limitations & Open Questions

* ranking logic is heuristic and not data-driven
* no automatic weight decay or long-term learning
* no offline evaluation or A/B testing
* scalability and security concerns are not addressed


---

## Tech Stack (Current Implementation)

* **Frontend**: React (Vite, TypeScript)
* **LLM**: Google Gemini API (used as a replaceable semantic parser)
* **State / Storage**: Client-side state + LocalStorage (demo only)
* **Ranking Logic**: Client-side re-ranking

---

## Development Philosophy

This repository is developed incrementally:

* features are added step by step
* design choices are revisited and occasionally revised
* commit history is preserved to reflect this progression

The project prioritizes learning and reasoning over completeness.

---

## License

MIT License

---

## Closing Note

This project should be read as a **learning artifact**.

It represents an attempt to reason carefully about how LLMs might fit into real systems without over-relying on them, and to practice building small, explainable systems before attempting more complex architectures.