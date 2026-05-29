#!/bin/bash
cd /opt/crm
docker compose build --no-cache 2>&1 | tail -50
