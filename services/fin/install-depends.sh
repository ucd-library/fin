#! /bin/bash

apt-get update
apt-get install -y --no-install-recommends git jq zip unzip vim apt-transport-https ca-certificates gnupg dnsutils
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] http://packages.cloud.google.com/apt cloud-sdk main" | \
  tee -a /etc/apt/sources.list.d/google-cloud-sdk.list
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | \
  apt-key --keyring /usr/share/keyrings/cloud.google.gpg add - 
  
apt update -y && apt install --no-install-recommends -y google-cloud-cli
rm -rf /var/lib/apt/lists/*
apt-get clean