add_header Strict-Transport-Security "max-age=63072000; includeSubDomains;
preload" always; add_header X-Content-Type-Options "nosniff" always; add_header
X-Frame-Options "DENY" always; add_header Referrer-Policy
"strict-origin-when-cross-origin" always; add_header Permissions-Policy
"camera=(), microphone=(), geolocation=()" always; add_header X-XSS-Protection
"1; mode=block" always; add_header Content-Security-Policy "default-src 'self';
script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
font-src 'self' data:; connect-src 'self' https://formspree.io
https://s3.amazonaws.com https://*.amazonaws.com blob:; worker-src 'self' blob:;
object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
