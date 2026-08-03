# Marathon — requirements

## Concept

Marathon is a chronological movie-watching app built around an **Explore pool**
of sources, modelled after Binge's channel list. A source is a person (actor /
producer / director), a single movie, or a whole saga. The pool feeds the
Explore screen, which aggregates every film from every source into one
chronological, filterable marathon.

## Screens (tabs)

1. **People** — search actors, producers and directors (Wikidata). Each result
   can be added to the Explore pool. Opening a person shows their photo, bio and
   chronological filmography (with acted / produced / directed tags).
2. **Movies** — search films, same interaction as People. A film's detail shows
   poster, plot, facts, cast (clickable through to People) and, when the film
   belongs to a saga, a one-tap "add saga to pool".
3. **Explore** — the marathon itself. Every film from every enabled pool source,
   deduplicated, in chronological release order.

## Explore pool

- Always visible (a chip bar under the tabs, on every screen).
- Each pool entry is a *preset search filter* for movies: adding
  e.g. Leonardo DiCaprio means "all of his movies" become part of Explore.
- Tapping a chip jumps to Explore soloed on that source; tapping again shows
  all sources. Chips have a remove (×) control.
- Pool and each source's resolved movie list persist in localStorage.

## Explore screen behaviour (inherited from Binge)

- Collapsible **Filters**: one switch per pool source (like Binge channels,
  with select/clear all), "released up to" year/month/day cutoff sliders, and a
  show-watched toggle + clear-watched.
- Toolbar: sort (oldest/newest) and grouping (flat Timeline — default —,
  by Source, by Year).
- Watched tracking per film, progress bar, and an "Up next" strip pointing at
  the first unwatched film in chronological order (respecting filters).

## Data

Live, keyless, client-side only: Wikidata SPARQL (search, facts, cast,
filmographies, sagas) + Wikipedia (posters, plot summaries). No backend; all
state in localStorage.
