# gmail-contactlabel-filters

I made this to scratch my own itch while watching TV on the couch... meaning it needs a lot more clean up for public consumption but it works

For now...

Enable the Gmail API and download a credentials.json file
https://developers.google.com/gmail/api/quickstart/nodejs#step_1_turn_on_the

Place credentials.json in the secrets/ folder

Create some groups (aka labels) in Google Contacts with the name prefixed with the ⭕ emoji

Run sync.js

Filters and labels will be created in Gmail based on the Contact groups you made earlier

Every time you run sync.js those filters will be kept in sync with the contents of your Contact groups

Any Gmail filters that label email with a Gmail label prefixed with the ⭕ emoji will be managed by sync.js. Do not attempt to create your own filters that label email with a ⭕ prefix or change the filters created by this script. If you do - those filters will eventually be overwritten.