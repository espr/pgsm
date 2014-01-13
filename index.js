var fs = require('fs');
var path = require('path');
var mc = require('minicolor');

var Pgsm = module.exports = function(opts){
  return new pgsm(opts);
};

var _tableName = "_pgsm";
Object.defineProperty(Pgsm, "tableName", {
  get: function(){return _tableName;}
});

Pgsm.log = function(){
  process.stdout.write(mc.grey(Array.prototype.join.call(arguments," "))+"\n");
};

function pgsm(opts){
  this.db = opts.db;
  this.migrationsPath = opts.migrationsPath;
}

pgsm.prototype.migrate = function(cb) {
  var mp = this.migrationsPath;
  var migrationsDir = fs.readdirSync(this.migrationsPath);

  var _db = this.db;
  this.getVersion(function(err, currentVersion){
    if (err) return cb(err);

    var newMigrations = migrationsDir.filter(function(d){
      return currentVersion < _getMigrationVersion(d);
    });

    if (newMigrations.length===0) {
      Pgsm.log("no new migrations, db at version "+currentVersion);
      cb();
    } else {
      var highestVersion = currentVersion;
      var updateVersion = function(nv, ncb){
        this.setVersion(nv, function(err){
          if (err) return cb(err);
          ncb();
        });
      }.bind(this);
      var migrateDone = function(){
        Pgsm.log("db now at version "+highestVersion);
        cb();
      }.bind(this);
      var migrateFns = newMigrations.map(function(m){
        return function(){
          Pgsm.log("running migration: "+m);
          _db.query(_readMigration(path.join(mp,m)).up, function(err, res){
            if (err) return cb(err);
            highestVersion = _getMigrationVersion(m);
            updateVersion(highestVersion, function(){
              if (err) return cb(err);
              (migrateFns.shift()||migrateDone)();
            });
          });
        };
      });
      migrateFns.shift()();
    }
  }.bind(this));
};

pgsm.prototype.rollback = function(ts, cb) {
  var mp = this.migrationsPath;
  var migrationsDir = fs.readdirSync(this.migrationsPath);

  var _db = this.db;
  this.getVersion(function(err, currentVersion){
    if (err) return cb(err);

    if (ts) {
      var targetVersion = ts;
    } else {
      var targetVersion = "0";
      migrationsDir.forEach(function(d){
        var mv = _getMigrationVersion(d);
        if (mv > targetVersion && mv < currentVersion) {
          targetVersion = mv;
        }
      });
    }

    var rollbackMigrations = migrationsDir.filter(function(d){
      var mv = _getMigrationVersion(d)
      return targetVersion < mv && mv <= currentVersion;
    }).reverse();

    if (rollbackMigrations.length===0) {
      Pgsm.log("no migrations to rollback, db at version "+currentVersion);
      cb();
    } else {
      var updateVersion = function(nv, ncb){
        this.setVersion(nv, function(err){
          if (err) return cb(err);
          ncb();
        });
      }.bind(this);
      var migrateDone = function(){
          Pgsm.log("db now at version "+targetVersion);
          cb();
      }.bind(this);
      var migrateFns = rollbackMigrations.map(function(m){
        return function(){
          Pgsm.log("rolling back migration: "+m);
          _db.query(_readMigration(path.join(mp,m)).down, function(err, res){
            if (err) return cb(err);
            updateVersion(targetVersion, function(){
              (migrateFns.shift()||migrateDone)();
            });
          });
        };
      });
      migrateFns.shift()();
    }
  }.bind(this));
};

var migrationTemplate = "-- up -------\n\n-- down -----\n\n";

pgsm.prototype.create = function(name) {
  if (!name) name = "unnamed"
  var fname = __timestamp(new Date())+"_"+__unixify(name)+".sql";
  var fpath = path.join(this.migrationsPath, fname);
  fs.writeFileSync(fpath, migrationTemplate);
  Pgsm.log("created migration: "+fname);
};

pgsm.prototype.getVersion = function(cb){
  var _db = this.db;
  this._findOrCreatePgsmTable(function(err){
    if (err) return cb(err);
    _db.query("SELECT version FROM "+_tableName+" LIMIT 1", function(err, res){
      if (err) return cb(err);
      cb(null, res.rows[0].version);
    });
  });
};

pgsm.prototype.setVersion = function(version, cb){
  var _db = this.db;
  this._findOrCreatePgsmTable(function(err){
    if (err) return cb(err);
    _db.query("UPDATE "+_tableName+" SET version = $1", [version], function(err, res){
      if (err) return cb(err);
      if (res.rowCount!==1) return cb(new Error("could not pgsm#setVersion "+version));
      cb(null);
    });
  });
};

pgsm.prototype._findOrCreatePgsmTable = function(cb){
  var _db = this.db;
  _db.query("SELECT relname FROM pg_class WHERE relname = '"+_tableName+"'", function(err, res){
    if (err) return cb(err);
    if (res.rowCount===1) {
      cb(null);
    } else {
      _db.query("CREATE TABLE \""+_tableName+"\" (\"version\" VARCHAR)" ,function(err){
        if (err) return cb(err);
        _db.query("INSERT INTO \""+_tableName+"\" (version) VALUES ('0')" ,function(err){
          cb(err);
        });
      });
    }
  });
}

function MigrationError(msg, path, line, col){
  this.message = msg;
  this.stack = "Error: "+msg+"\n    at"+path+":"+line+":"+col;
}
MigrationError.prototype = Object.create(Error.prototype);

function _readMigration(mPath){
  var mLines = fs.readFileSync(mPath, {encoding:"utf8"}).split(/\r?\n/);
  var mode = null;
  var result = {up:"",down:""}
  mLines.forEach(function(l, idx){
    if ("--"===l.substring(0,2)) {
      if (/^-- up --/.test(l)) {
        mode = 'up';
      } else if (/^-- down --/.test(l)) {
        mode = 'down';
      }
    } else if (mode) {
      result[mode] += l+'\n';
    } else {
      throw new MigrationError("migration sql outside of up or down section", mPath, idx+1, 1);
    }
  });
  return result;
};

function _getMigrationVersion(mn){
  if (!/^\d+_/.test(mn)) throw new Error("invalid migration filename: "+mn);
  return mn.substring(0, mn.indexOf('_'));
}

function __pad(n){ return (n<10 ? "0" : "")+n; }
function __timestamp(d) {
  return ""+d.getFullYear()+__pad(d.getMonth()+1)+__pad(d.getDate())+
      __pad(d.getHours())+__pad(d.getMinutes())+__pad(d.getSeconds());
}
function __unixify(s){
  return s.toLowerCase().replace(/ /g,'_').replace(/[^a-z0-9_]+/g,'');
}
