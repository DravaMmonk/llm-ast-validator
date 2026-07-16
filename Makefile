.PHONY: up install check api web e2e audit demo-real

install:
	npm ci

# Runs the local API and the Vite frontend together. Ctrl-C stops both:
# the trap kills the whole process group rather than orphaning the API.
up:
	@trap 'kill 0' EXIT INT TERM; \
	npm run dev:api & \
	npm run dev & \
	wait

api:
	npm run dev:api

web:
	npm run dev

check:
	npm run check

e2e:
	npm run test:e2e

audit:
	npm run audit:release -- --all-history

# The one documented command for the real-data walkthrough: verify and import
# the user-supplied workbook, then start the application. Fails with
# DATASET_SOURCE_MISSING and instructions if the workbook is not in place.
demo-real:
	npm run prepare:cohort
	@$(MAKE) up
