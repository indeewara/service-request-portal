#!/bin/bash
# Runs inside LocalStack once S3 is ready: creates the private photo bucket.
set -euo pipefail
BUCKET=service-request-photos

awslocal s3api head-bucket --bucket "$BUCKET" 2>/dev/null \
  || awslocal s3api create-bucket --bucket "$BUCKET"

# No public access, ever. Photos are only reachable through pre-signed URLs.
awslocal s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

awslocal s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# The browser uploads straight to S3, so the web app's origin needs CORS.
awslocal s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration \
  '{"CORSRules":[{"AllowedOrigins":["http://localhost:3000"],"AllowedMethods":["GET","POST"],"AllowedHeaders":["*"],"MaxAgeSeconds":3000}]}'

echo "S3 bucket $BUCKET ready"
