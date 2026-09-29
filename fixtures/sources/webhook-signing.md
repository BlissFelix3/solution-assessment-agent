# Webhook signing

Each webhook POST includes an HMAC-SHA256 signature header.
An integration verifies the signature against its endpoint secret.
