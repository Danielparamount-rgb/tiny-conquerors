/* Prints a fresh VAPID key pair for web push. Run once, then set the three
   environment variables on the relay service (Render → Environment):
     VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (a mailto: address)
   Never commit the private key. */
import webpush from 'web-push';
const k = webpush.generateVAPIDKeys();
console.log('VAPID_PUBLIC_KEY=' + k.publicKey);
console.log('VAPID_PRIVATE_KEY=' + k.privateKey);
console.log('VAPID_SUBJECT=mailto:you@example.com');
