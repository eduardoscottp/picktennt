# Play Sessions 1.1

Play Sessions lets any signed-in player create and share a scheduled recreational session. A session records its start time, duration, courts, venue, player limit, description, and registration format.

## Registration formats

- `random_player`: players join one roster and decide teams at the court.
- `by_partner`: the session owns stable pair and seat IDs. Players choose any free seat and can move while registration remains open.

Registration closes when the organizer closes it, the roster reaches its limit, the session is cancelled, or the start time arrives. Capacity and seat mutations run through locked database functions so simultaneous joins cannot overfill the roster or claim the same seat.

An organizer can edit an upcoming session, close or reopen registration, remove players, and explicitly allow a removed player to rejoin. Players can leave at any time. There is no limit on the number of sessions a player may create.

## Invitations

The canonical invitation is `https://app.picktennt.com/s/{join_code}`. The public page exposes session details and the current player count, but not the roster. Associated Domains route the same link into the iOS app, where a signed-in player explicitly joins or chooses a partner seat.

Deploy `supabase/migrations/011_play_sessions.sql` before releasing iOS 1.1. The web deployment must serve `/.well-known/apple-app-site-association` from `app.picktennt.com`, and `NEXT_PUBLIC_APP_STORE_URL` can point people without the app to its App Store page.

## Watch follow-up

The schema keeps stable session, member, pair, and seat IDs for a later Watch feature. That upgrade can create a game from the session roster, prefill the Watch user's registered partner, and let the user select opponents without changing the 1.1 registration model.
