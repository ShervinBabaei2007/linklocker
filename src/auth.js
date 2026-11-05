const express = require("express");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const passport = require("passport");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");
const User = require("./models/User");

// Configure Passport's Google strategy. Credentials come from environment variables only.
function configurePassport() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
    throw new Error("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL are required.");
  }

  // OAuth 2.0: Passport exchanges Google's authorization code for the user's profile.
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
      },
      // Verify callback: runs after the code exchange succeeds, with the Google profile.
      async (accessToken, refreshToken, profile, done) => {
        try {
          // Find the user by Google ID, creating the record on first sign-in.
          const user = await User.findOneAndUpdate(
            { googleId: profile.id },
            {
              $set: {
                displayName: profile.displayName || "",
                email: profile.emails?.[0]?.value || "",
              },
            },
            { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
          );
          done(null, user);
        } catch (error) {
          done(error);
        }
      },
    ),
  );

  // Store only the user id in the session and reload the user on each request.
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      done(null, (await User.findById(id)) || false);
    } catch (error) {
      done(error);
    }
  });
}

// Middleware: reject unauthenticated API calls with 401.
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "Sign in with Google to do that." });
}

// Build the session + passport middleware and the /auth routes.
function setupAuth(app, mongoUrl) {
  configurePassport();

  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required.");
  }

  app.use(
    session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ mongoUrl }),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        // Secure cookies require HTTPS (nginx terminates TLS and "trust proxy" is set).
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  // Routes are mounted at /auth below, so these become /auth/google and /auth/google/callback.
  const router = express.Router();
  // Step 1: redirect the user to Google's consent screen.
  router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));
  // Step 2: Google redirects back here with an authorization code; Passport exchanges it,
  // logs the user in (creates the session), then we send them home.
  router.get(
    "/google/callback",
    passport.authenticate("google", { failureRedirect: "/?login=failed" }),
    (req, res) => res.redirect("/"),
  );
  router.post("/logout", (req, res, next) => {
    req.logout((error) => {
      if (error) return next(error);
      req.session.destroy(() => res.status(204).end());
    });
  });
  app.use("/auth", router);

  // Let the front end know who (if anyone) is signed in.
  app.get("/api/me", (req, res) => {
    if (!req.isAuthenticated()) return res.json({ user: null });
    res.json({ user: { name: req.user.displayName, email: req.user.email } });
  });
}

module.exports = { setupAuth, requireAuth };
