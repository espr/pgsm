-- up -------

CREATE TABLE "fixture3" (
  "id" SERIAL,
  PRIMARY KEY ("id"));

-- down -----

DROP TABLE IF EXISTS "fixture3";
