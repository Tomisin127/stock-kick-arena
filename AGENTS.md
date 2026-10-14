<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Player identity is a local profile (id + secret key in localStorage) verified by server functions that hash the key; why: Privy email login is optional and no Cloud auth is used.
- Online PvP uses realtime broadcast/presence only, with the host (team 0) running physics and streaming snapshots; why: avoids desync between browsers.
- Rank points are computed in the `leaderboard` view (game points + lending points accrued over time); why: one source of truth for tiers.
