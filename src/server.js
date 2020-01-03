var db = require("./db");
var express = require("express");
var expressWinston = require("express-winston");
var fs = require("fs");
var ice = require("./ice");
var socketIO = require("socket.io");
var winston = require("winston");

process.on("unhandledRejection", (reason, p) => {
  p.catch(err => {
    log.error("Exiting due to unhandled rejection!");
    log.error(err);
    process.exit(1);
  });
});

process.on("uncaughtException", err => {
  log.error("Exiting due to uncaught exception!");
  log.error(err);
  process.exit(1);
});

var app = express();
var port =
  process.env.PORT || (process.env.NODE_ENV === "production" ? 80 : 3000);

if (!process.env.QUIET) {
  app.use(
    expressWinston.logger({
      winstonInstance: winston,
      expressFormat: true
    })
  );
}

app.get("/app.js", require("./middleware/javascript"));
app.use(require("./middleware/static"));

app.use([
  require("./middleware/bootstrap"),
  require("./middleware/error"),
  require("./middleware/react")
]);

function bootServer(server) {
  var io = socketIO(server);
  io.set("transports", ["polling"]);

  io.on("connection", function(socket) {
    var upload = null;

    socket.on("upload", function(data, res) {
      if (upload) return;
      db.create(socket).then(u => {
        upload = u;
        upload.fileName = data.fileName;
        upload.fileSize = data.fileSize;
        upload.fileType = data.fileType;
        res({
          token: upload.token,
          shortToken: upload.shortToken
        });
      });
    });

    socket.on("requestDownload", function(data, res) {
      if (!upload) {
        upload = db.find(data.token) || db.findShort(data.shortToken)
      }

      if (!upload) {
        res(null)
      }

      upload.downloaders.push({
        ip: socket.request.connection.remoteAddress
      })

      upload.socket.emit(
        'updateDownloaders',
        upload.downloaders
      );

      res({
        fileName: upload.fileName,
        fileSize: upload.fileSize,
        fileType: upload.fileType
      });
    });

    socket.on("rtcConfig", function(_, res) {
      ice.getICEServers().then(function(iceServers) {
        res({ iceServers: iceServers });
      });
    });

    socket.on("disconnect", function() {
      db.remove(upload);
    });
  });

  server.on("error", function(err) {
    winston.error(err.message);
    process.exit(1);
  });

  server.listen(port, function(err) {
    var host = server.address().address;
    var port = server.address().port;
    winston.info("FilePizza listening on %s:%s", host, port);
  });
}

if (process.env.HTTPS_KEY && process.env.HTTPS_CERT) {
  // user-supplied HTTPS key/cert
  var https = require("https");
  var server = https.createServer({
    key: fs.readFileSync(process.env.HTTPS_KEY),
    cert: fs.readFileSync(process.env.HTTPS_CERT),
  }, app)
  bootServer(server)
} else {
  // no HTTPS
  var http = require("http");
  var server = http.Server(app)
  bootServer(server)
}
