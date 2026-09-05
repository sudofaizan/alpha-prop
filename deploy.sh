#!/usr/bin/env bash
# Deploy AlphaFX static trader portal to S3
#
# alphafx.org in us-east-1 is used for other work (bucket names are global).
# This script deploys to a separate bucket in ap-south-1 by default.
#
# Run (requires AWS CLI configured locally — no creds in this repo):
#   AWS_PROFILE=your-profile AWS_DEFAULT_REGION=ap-south-1 ./deploy.sh
#
# Override bucket:
#   ALPHAFX_BUCKET=my-name ./deploy.sh
#
# One-time setup:
#   aws configure --profile your-profile

set -euo pipefail

if [[ -z "${AWS_PROFILE:-}" ]]; then
  echo "Error: set AWS_PROFILE to your configured AWS CLI profile."
  echo "Example: AWS_PROFILE=your-profile ./deploy.sh"
  exit 1
fi
# Bucket lives in ap-south-1 — do not inherit a conflicting AWS_DEFAULT_REGION from the shell.
REGION="${ALPHAFX_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$REGION"

BUCKET="${ALPHAFX_BUCKET:-alphafx-trader-portal}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="${SCRIPT_DIR}/website"

AWS=(aws --profile "$AWS_PROFILE" --region "$REGION")

# S3 website endpoint format differs by region:
#   us-east-1:  bucket.s3-website-us-east-1.amazonaws.com
#   others:     bucket.s3-website.ap-south-1.amazonaws.com  (dots, not hyphens)
website_host() {
  local bucket=$1 region=$2
  if [[ "$region" == "us-east-1" ]]; then
    echo "${bucket}.s3-website-us-east-1.amazonaws.com"
  else
    echo "${bucket}.s3-website.${region}.amazonaws.com"
  fi
}

if [[ ! -d "$WEB_DIR" ]]; then
  echo "Error: website folder not found at $WEB_DIR"
  exit 1
fi

if ! command -v aws &>/dev/null; then
  echo "Error: AWS CLI not installed. https://aws.amazon.com/cli/"
  exit 1
fi

echo "→ Profile: $AWS_PROFILE"
echo "→ Region:  $REGION"
echo "→ Bucket:  $BUCKET"
echo "→ Checking credentials..."
if ! "${AWS[@]}" sts get-caller-identity &>/dev/null; then
  echo "Error: profile '$AWS_PROFILE' not configured."
  echo "Run: aws configure --profile $AWS_PROFILE"
  exit 1
fi

echo "→ Creating bucket if needed..."
if ! "${AWS[@]}" s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  if [[ "$REGION" == "us-east-1" ]]; then
    "${AWS[@]}" s3api create-bucket --bucket "$BUCKET"
  else
    "${AWS[@]}" s3api create-bucket --bucket "$BUCKET" \
      --create-bucket-configuration "LocationConstraint=$REGION"
  fi
  echo "   Created $BUCKET in $REGION"
else
  BUCKET_REGION=$("${AWS[@]}" s3api get-bucket-location --bucket "$BUCKET" --query LocationConstraint --output text)
  [[ "$BUCKET_REGION" == "None" || "$BUCKET_REGION" == "null" || -z "$BUCKET_REGION" ]] && BUCKET_REGION="us-east-1"
  if [[ "$BUCKET_REGION" != "$REGION" ]]; then
    echo "Error: '$BUCKET' lives in $BUCKET_REGION, not $REGION."
    echo "Use a new name: ALPHAFX_BUCKET=alphafx-portal-v2 ./deploy.sh"
    exit 1
  fi
  echo "   Bucket exists in $REGION"
fi

echo "→ Static website hosting"
"${AWS[@]}" s3 website "s3://${BUCKET}" \
  --index-document index.html \
  --error-document index.html

echo "→ Public read policy"
"${AWS[@]}" s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

"${AWS[@]}" s3api put-bucket-policy --bucket "$BUCKET" --policy "$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadGetObject",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::${BUCKET}/*"
  }]
}
EOF
)"

echo "→ Sync website/"
"${AWS[@]}" s3 sync "$WEB_DIR/" "s3://${BUCKET}/" \
  --delete \
  --exclude ".DS_Store" \
  --exclude "deploy.sh"

echo "→ Fix content-types"
while IFS= read -r -d '' f; do
  key="${f#${WEB_DIR}/}"
  case "$key" in
    *.html) ctype="text/html" ;;
    *.css)  ctype="text/css" ;;
    *.js)   ctype="application/javascript" ;;
    *) continue ;;
  esac
  "${AWS[@]}" s3 cp "s3://${BUCKET}/${key}" "s3://${BUCKET}/${key}" \
    --metadata-directive REPLACE --content-type "$ctype" --quiet
done < <(find "$WEB_DIR" \( -name '*.html' -o -name '*.css' -o -name '*.js' \) -print0)

CNAME="$(website_host "$BUCKET" "$REGION")"
URL="http://${CNAME}/"

echo ""
echo "✓ Deploy complete"
echo "  Website (HTTP):  $URL"
echo "  Dashboard:       ${URL}dashboard.html"
echo "  CNAME target:    $CNAME"
echo ""
echo "  IMPORTANT: S3 static websites do NOT support HTTPS."
echo "  Use http:// not https:// — otherwise the page will hang on loading."
echo ""
echo "  For HTTPS: add CloudFront in front of this bucket, or point alphafx.org"
echo "  via CloudFront with an ACM certificate."
echo ""
