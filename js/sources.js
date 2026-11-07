// sources.js — official places to find matches, shown on the Discover tab.
// Each link was opened by hand on LINKS_CHECKED. `checked: false` means it
// couldn't be confirmed automatically; open it yourself and flip it to true.
// When you re-check the links, update LINKS_CHECKED.
// Only USPSA and PCSL are listed, by choice. Add a group here to bring another back.

export const LINKS_CHECKED = '2026-11-06';

export const MATCH_SOURCES = [
  {
    group: 'USPSA & PCSL',
    links: [
      {
        title: 'PractiScore match search',
        url: 'https://practiscore.com/search/matches',
        note: 'Most local USPSA and PCSL matches take registration here.',
        checked: false, // site shows a "verify you are human" page to automated checks
      },
    ],
  },
  {
    group: 'USPSA',
    links: [
      { title: 'Upcoming local matches', url: 'https://uspsa.org/matches/list/local', note: 'A newer listing. Many clubs don’t post here yet.', checked: true },
      { title: 'Major matches (Level II & III)', url: 'https://uspsa.org/matches/major', note: 'Area, state and national championships.', checked: true },
      { title: 'Find a club', url: 'https://uspsa.org/find-a-club', note: 'Search by ZIP, county or state.', checked: true },
    ],
  },
  {
    group: 'PCSL',
    links: [
      { title: 'PCSL website', url: 'https://www.pcsleague.us/', note: 'Rules and news. It has no match finder; PCSL matches are listed on PractiScore.', checked: true },
    ],
  },
];
