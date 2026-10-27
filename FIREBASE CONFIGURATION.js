/* Campus Bazaar settings.
   Fill this in by following README.md (Step 1 to Step 4).
   Until the Firebase keys AND the college domain are filled in, the site
   shows "not set up yet" and nobody can sign in. */

window.CAMPUS_CONFIG = {
  // Email domains that may sign in, for example ['mycollege.edu.in'].
  // Required. Put the same domain in firestore.rules too, because the rules
  // are what really keep outsiders out.
  allowedDomains: ['its.edu.in'],

  // Copy these four values from Firebase console > Project settings > Your apps.
  // The apiKey is not a secret. Firestore rules decide who can read and write.
  firebase: {
    apiKey: 'AIzaSyBVfl7gJd81pp3ZnWAAaaXiVa_AG9ijLWU',
    authDomain: 'campus-bazar-e670b.firebaseapp.com',
    projectId: 'campus-bazar-e670b',
    appId: '1:814266757937:web:c8ba545a35397322533610'
  }
};
