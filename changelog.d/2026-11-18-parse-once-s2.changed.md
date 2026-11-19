- **A book's text is read from the PDF once, then saved for every seat.** The
  first time a GM seat reads a staged book (an import, a repair, a table scan),
  or right after a GM stages one, the book's text is parsed and saved beside the
  PDF, in a `parsed` folder of the staged-books folder in the Data directory,
  and the book's shelf journal records which file is current. Every later
  read, on any seat and in any session, takes the text from that file and
  fetches no PDF: a seat checks only that the PDF is still on the server, at
  the size it was read at, with one small request. The first read of a book
  that was staged before this release pays one fetch and one parse, 15 to 45
  seconds for a large book; a Player seat never parses and opens the PDF as
  before until a GM seat has saved the text. Pictures, scene maps and the
  character sheet's Export still read the PDF itself. Each parse leaves a new
  file, because Foundry cannot delete or overwrite one; an old file is left
  behind when a book is staged again or the module's PDF reader is updated. The
  saved text is as readable by a signed-in user who knows its path as the PDF
  is.
