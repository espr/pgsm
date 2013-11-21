-- up -------

CREATE TABLE "fixture2" (
  "id" SERIAL,
  PRIMARY KEY ("id"));

-- down -----

DROP TABLE IF EXISTS "fixture2";
