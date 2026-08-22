// Values come from the repo-root app.config.json and `.is_template`, supplied by
// the `app-config` plugin in vite.config.ts.
//
// APP_NAME: the application's display name.
// IS_TEMPLATE: true only in the template repo itself, where `.is_template` still
// exists. Guarding template-only routes with it drops them from a fork's bundle.
export { APP_NAME, IS_TEMPLATE } from 'virtual:app-config'
