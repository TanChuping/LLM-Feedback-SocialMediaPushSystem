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
* high cost, high consumption of tokens

This project explores a more conservative design:

> **Use an LLM only as a semantic translator — converting natural-language feedback into structured preference adjustments — while keeping all ranking decisions inside a transparent, rule-based system.**

The emphasis is on engineering clarity, not model sophistication.

---

## How does it work

The system runs entirely client-side to demonstrate immediate responsiveness and to keep the feedback loop easy to inspect.

**Workflow:**

1.  **Cold Start (Randomization):**
    *   On load, a random User Profile (2-5 tags, low weights) is generated.
    *   The Feed is completely shuffled to ensure diversity and break echo chambers immediately.

2.  **User Feedback:**
    *   User clicks "..." on a post and provides natural language feedback (e.g., "I want to see hiking trails, not tech news").

3.  **Stage 1: Intent Analysis (LLM):**
    *   The LLM parses the feedback.
    *   It outputs **Tag Adjustments** (Weights +/-) and checks for **Explicit Search Intent** (e.g., "hiking").

4.  **Stage 1.5: Hybrid Retrieval (The "Injection" Layer):**
    *   **If no search intent:** The system ranks posts purely by Tag Weights (Algo) and picks the Top 25.
    *   **If search intent exists:**
        *   **Pool A:** Top 15 posts based on Interest Profile (Algo).
        *   **Pool B:** Top 10 posts based on a *Deterministic Keyword Search* (Dead Algo).
        *   These lists are merged to ensure the user's specific request is honored without losing general personalization.

5.  **Stage 2: Contextual Reranking (LLM):**
    *   The merged candidate list (from Stage 1.5) is sent to the LLM.
    *   The LLM Adjust and reorder the entered posts, prioritizing the user's immediate request while weaving in general interests.

6.  **Stage 3: Memory Cleanup (Background):**
    *   A background process periodically asks the LLM to review the User's Feedback History.
    *   It identifies contradictions (e.g., User liked "Gaming" yesterday but hates it today) and decays old tags to keep the profile fresh.

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

---

### D. Exploration Noise

A small random perturbation used only to break ties between similarly scored items.

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

### Design Constraints

* Strict JSON schema enforcement
* Parsing failures fall back to a no-op update
* The LLM never emits final scores or rankings

This keeps the system debuggable and limits the blast radius of model errors.

---

## Tech Stack (Current Implementation)

* **Frontend**: React (Vite, TypeScript)
* **LLM**: Groq API (Llama 3 70B) for low latency JSON parsing.
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