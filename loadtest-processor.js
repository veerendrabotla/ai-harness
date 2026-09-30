// Artillery processor for the PHASE 13 #13 multi-instance load test.
// $randomNumber() produced colliding signup emails (409 storms) — unique
// addresses are generated here deterministically per virtual user instead.
// ESM because the root package.json declares "type": "module".
let counter = 0;

export function setUniqueEmail(context, events, done) {
  counter += 1;
  context.vars.signupEmail = `loadtest-${Date.now()}-${counter}-${Math.floor(Math.random() * 1e6)}@example.com`;
  return done();
}
