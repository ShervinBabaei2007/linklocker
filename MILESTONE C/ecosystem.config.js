// Both workers share MongoDB for links and sessions. Each listens on loopback
// using a different port; HAProxy makes the routing choice for every request.
module.exports = {
  apps: [
    { name: "linklocker-1", script: "src/app.js", env: { PORT: 3000 } },
    { name: "linklocker-2", script: "src/app.js", env: { PORT: 3001 } },
  ],
};
