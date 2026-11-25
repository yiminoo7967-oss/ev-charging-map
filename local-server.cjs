"use strict";

const http = require("node:http");
const path = require("node:path");
const { createReadStream } = require("node:fs");
const { execFile } = require("node:child_process");

const assets = new Set([
  "index.html", "style.css", "theme.js", "app.js", "data.js", "boundaries.js",
  "built-in-stations.js", "built-in-rates.js", "bungaeman-background.png", "bungaeman-flying.png"
]);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png"
};

const server = http.createServer((request, response) => {
  const pathname = request.url.split("?")[0];
  const filename = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!assets.has(filename) || (request.method !== "GET" && request.method !== "HEAD")) {
    response.writeHead(404).end();
    return;
  }
  const headers = {
    "Content-Type": types[path.extname(filename)],
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff"
  };
  if (request.method === "HEAD") {
    response.writeHead(200, headers).end();
    return;
  }
  const stream = createReadStream(path.join(__dirname, filename));
  stream.once("open", () => {
    response.writeHead(200, headers);
    stream.pipe(response);
  });
  stream.once("error", () => {
    if (!response.headersSent) response.writeHead(404);
    response.end();
  });
  response.once("close", () => stream.destroy());
});

server.on("error", error => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(0, "127.0.0.1", () => {
  const url = "http://127.0.0.1:" + server.address().port + "/";
  console.log(url);
  if (process.argv.includes("--open")) {
    execFile("rundll32.exe", ["url.dll,FileProtocolHandler", url], { windowsHide: true }, error => {
      if (error) console.log("Open the URL above in your browser.");
    });
  }
});
