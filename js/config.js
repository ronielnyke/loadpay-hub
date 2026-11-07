/* ==========================================================
   LoadPay Hub – CONFIGURATION (edit this file only)
   See README.md for step-by-step setup.
   ========================================================== */
window.APP_CONFIG = {
  // Firebase Console > Project settings > Your apps > Web app
  firebase: {
    apiKey: 'AIzaSyDjDV5q0vo2wbBzVzEVcke2mtlMOqGUIvs',
    // On your Netlify site the Google popup shows lambaconnect.netlify.app (needs the 2 setup steps in README section 5).
    authDomain: location.hostname === 'lambaconnect.netlify.app' ? 'lambaconnect.netlify.app' : 'loadpay-hub.firebaseapp.com',
    projectId: 'loadpay-hub',
    storageBucket: 'loadpay-hub.firebasestorage.app',
    messagingSenderId: '345647769736',
    appId: '1:345647769736:web:0e80c927660721ce71173d',
    measurementId: 'G-KP0NGL0XD2'
  },
  // emailjs.com > Account (public key), Email Services, Email Templates
  emailjs: {
    publicKey: 'S3_XQI5mfn8MMdGhM',
    serviceId: 'service_gpk705s',
    templateId: 'template_lph_activation*',            // receipt email template
    activationTemplateId: 'template_lph_activation*' // activation key email template
  },
  // Default GCash account. The operator can change it later in Dashboard > Payment Settings.
  gcash: { number: '09XXXXXXXXX', name: 'YOUR ACCOUNT NAME', qr: '' }, // qr: e.g. 'img/gcash-qr.png'
  maya:  { number: '', name: '' },                                    // optional
  // Google accounts that can open the Operator Dashboard
  owner: { name: 'Roniel Nyke Gonzales', email: 'ronielnyke@gmail.com' },
  adminEmails: ['ronielnyke@gmail.com'],
  commissionRate: 0.06
};
