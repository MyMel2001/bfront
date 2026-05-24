#!/bin/bash
cd "$(dirname "$0")"
git pull
npm i
npm run start > bsky-frontend.log 2>&1 &
