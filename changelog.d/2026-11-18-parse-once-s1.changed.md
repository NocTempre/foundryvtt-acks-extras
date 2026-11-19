- **Joining a world no longer downloads your books.** A seat that may read a
  staged book now lists it as open at join without fetching the PDF or starting
  a PDF worker: the first import, repair or sheet export that needs a book
  fetches that one file, once. On a Player seat nothing is fetched for the books
  the Judge shared, and the browser holds far less memory after joining. Where
  it shows: the import manager's Books tab (Settings tab → Game Settings →
  ACKS II — Extras → Manage imports → Books tab) lists the staged books as open straight after
  the world loads, and the official character sheet's Export button fetches
  `sheet.pdf` when pressed. A repair or rebuild over a book whose file has been
  removed from the server now reads nothing and deletes nothing; it says the
  book is not connected.
