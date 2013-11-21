-- up -------

CREATE TABLE "fixture1" (
  "id" SERIAL,
  PRIMARY KEY ("id"));

-- down -----

DROP TABLE IF EXISTS "fixture1";
