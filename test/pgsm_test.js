var path = require("path");
var mc = require("minicolor");
var pg = require("pg");

var Pgsm = require("../index.js");

describe("pgsm", function(){

  var _db, pgsm;

  this.slow(500);
  Pgsm.log = function(){};


  before(function(cb){
    _db = new pg.Client("postgres://pgsm_test:@localhost:5432/pgsm_test");
    _db.connect(function(err){
      if (err) return cb(err);

      pgsm = Pgsm({
        db: _db,
        migrationsPath: path.join(__dirname, "migrations")
      });

      cb();
    });
  });

  it("should store current migration version", function(cb){
    pgsm.getVersion(function(err, oldVersion){
      if (err) return cb(err);

      var TEST_VERSION = "3";
      pgsm.setVersion(TEST_VERSION, function(err){
        if (err) return cb(err);

        pgsm.getVersion(function(err, newVersion){
          assert.equal(newVersion, TEST_VERSION, "version persisted");

          cb();
        });
      });
    });
  });

  describe("migrate", function(){

    it("should migrate only migrations with a higher version number", function(cb){
      pgsm.setVersion("2", function(err){
        if (err) return cb(err);

        pgsm.migrate(function(err){
          if (err) return cb(err);

          pgsm.getVersion(function(err, newVersion){
            if (err) return cb(err);
            assert.equal(newVersion, "3", "version updated");

            _db.query("SELECT table_name FROM information_schema.tables WHERE table_name = 'fixture3';", function(err, res){
              if (err) return cb(err);
              assert(res.rowCount===1, "table fixture3 should exist");

              _db.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('fixture1','fixture2');", function(err, res){
                if (err) return cb(err);
                assert(res.rowCount===0, "table fixture1 or fixture2 should not exist");

                _db.query("DROP TABLE fixture3;", function(err, res){
                  if (err) return cb(err);
                  cb();
                });
              });
            });
          });
        });
      });
    });

  });

  describe("rollback", function(){

    it("if no rollback target, should only roll back the migrations with the latest version number", function(cb){
      pgsm.migrate(function(err){
        if (err) return cb(err);

        pgsm.rollback(null, function(err){
          if (err) return cb(err);

          _db.query("SELECT table_name FROM information_schema.tables WHERE table_name = 'fixture3';", function(err, res){
            if (err) return cb(err);
            assert(res.rowCount===0, "table fixture3 should not exist");

            _db.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('fixture1','fixture2');", function(err, res){
              if (err) return cb(err);
              assert(res.rowCount===2, "table fixture1 and fixture2 should exist");

              _db.query("DROP TABLE fixture1;", function(err, res){
                if (err) return cb(err);
                _db.query("DROP TABLE fixture2;", function(err, res){
                  if (err) return cb(err);
                  cb();
                });
              });
            });
          });
        });
      });
    });

    it("should only roll back to (but not including) the rollback target", function(cb){
      pgsm.migrate(function(err){
        if (err) return cb(err);

        pgsm.rollback("1", function(err){
          if (err) return cb(err);

          _db.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('fixture2','fixture3');", function(err, res){
            if (err) return cb(err);
            assert(res.rowCount===0, "table fixture 2 and fixture3 should not exist");

            _db.query("SELECT table_name FROM information_schema.tables WHERE table_name = 'fixture1';", function(err, res){
              if (err) return cb(err);
              assert(res.rowCount===1, "table fixture1 should exist");

              _db.query("DROP TABLE fixture1;", function(err, res){
                if (err) return cb(err);
                cb();
              });
            });
          });
        });
      });
    });

  });

  afterEach(function(cb){
    var testState = this.currentTest.state;
    _db.query("DROP TABLE IF EXISTS "+Pgsm.tableName, function(err){
      if (err) return cb(err);

      _db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';", function(err, res){
        if (err) return cb(err);

        if (res.rowCount > 0) {
          var dropDone = function(){
            if (testState==="failed") {
              cb();
            } else {
              cb(new Error(
                "tables remaining (now dropped): "+JSON.stringify(res.rows.map(function(m){return m.table_name;}))
              ));
            }
          };
          var dropFns = res.rows.map(function(r){
            return function(){
              _db.query("DROP TABLE "+r.table_name+";", function(err, res){
                if (err) return cb(err);
                (dropFns.shift()||dropDone)();
              });
            };
          });
          dropFns.shift()();
        } else {
          cb();
        }
      });
    });
  });

  after(function(){
    _db.end();
  });

});
