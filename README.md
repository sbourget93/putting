# App Template

## Overview
This repository is an application template meant to accelerate development by cutting out the boilerplate and letting developers (really just me...) start focusing immediately on application specific concerns.

## Usage Instructions
1) Use this template to create a new repository.
2) Delete `./.is_template`.
    - This lets coding agents know that you are working in a non-template application, preventing them from making template specific design choices.
3) Update the application name in `app.config.json`, and in both places in `infrastructure/app.tf`.
4) Delete the content from this README.md.
5) Update the Authorized JavaScript origins for the `apps` OAuth client to allow traffic for the new app.
