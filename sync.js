#!/usr/bin/env node

const fs = require('fs');
const util = require('util')
const readline = require('readline');
const { google } = require('googleapis');
const { exit } = require('process');
const _get = require('lodash.get');
const isEmail = require('sane-email-validation')

const args = process.argv.slice(2);

let log;
if (args[0] == '--verbose' || args[0] == '-v') {
    log = console.log;
} else {
    log = () => { };
}

const dump = data => log(util.inspect(data, { maxArrayLength: null, showHidden: false, depth: null, colors: true }));
const dd = data => { dump(data); process.exit(); }
const line = () => log('➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖');
const header = data => { log('\n'); line(); log(' ♦️  ' + data); line(); log('\n'); }

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.labels', 'https://www.googleapis.com/auth/contacts.readonly', 'https://www.googleapis.com/auth/gmail.settings.basic'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = './secrets/token.json';

// Load client secrets from a local file.
fs.readFile('./secrets/credentials.json', (err, content) => {
    if (err) return console.log('Error loading client secret file:', err);
    // Authorize a client with credentials, then call the Gmail API.
    authorize(JSON.parse(content), main);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getNewToken(oAuth2Client, callback);
        oAuth2Client.setCredentials(JSON.parse(token));
        callback(oAuth2Client);
    });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}

async function main(auth) {
    // https://github.com/googleapis/google-api-nodejs-client/tree/master/samples/gmail
    const gmail = google.gmail({ version: 'v1', auth });
    // https://github.com/googleapis/google-api-nodejs-client/tree/master/samples/people
    const people = google.people({ version: 'v1', auth });

    header('Get all managed contact groups');

    const { data: groups } = await people.people.get({ resourceName: 'contactGroups' });
    const contactGroupsByName = {};
    const contactGroupsByIndex = {};
    await Promise.all(groups.contactGroups.map(async group => {
        if (!group.name.match(/^⭕ /)) return;
        contactGroupsByName[group.name] = {};
        contactGroupsByName[group.name].id = group.resourceName; // might need formattedName?
        contactGroupsByName[group.name].emails = [];
        contactGroupsByIndex[group.resourceName] = {};
        contactGroupsByIndex[group.resourceName] = group.name;
    }));

    dump(contactGroupsByName);

    header('Populate contents of all managed contact groups');

    let connections = [];
    let { data: data } = await people.people.connections.list({
        personFields: ['emailAddresses', 'memberships'],
        resourceName: 'people/me',
        pageSize: 1000
    });
    connections = connections.concat(data.connections);
    while (data.totalItems > connections.length) {
        nextPageToken = data.nextPageToken;
        let { data: newdata } = await people.people.connections.list({
            personFields: ['emailAddresses', 'memberships'],
            resourceName: 'people/me',
            pageSize: 1000,
            pageToken: nextPageToken
        });
        data = newdata;
        connections = connections.concat(data.connections);
    }
    await Promise.all(connections.map(async connection => {
        await Promise.all(connection.memberships.map(async membership => {
            if (!membership.contactGroupMembership) return;
            let groupName = contactGroupsByIndex[membership.contactGroupMembership.contactGroupResourceName];
            if (!connection.emailAddresses) return;
            await Promise.all(connection.emailAddresses.map(async emailAddress => {
                if (!contactGroupsByName[groupName]) return;
                if (!isEmail(emailAddress.value)) return;
                contactGroupsByName[groupName].emails.push(emailAddress.value);
            }));
        }));
    }));

    dump(contactGroupsByName);

    header('Get all managed mail labels');

    const { data: { labels: allMailLabels } } = await gmail.users.labels.list({ userId: 'me' });
    const filteredMailLabels = allMailLabels.filter(label => label.name.match(/^⭕ /));
    const mailLabelsById = {};
    const mailLabelsByName = {};
    await Promise.all(filteredMailLabels.map(async label => {
        mailLabelsById[label.id] = label.name;
        mailLabelsByName[label.name] = label.id;
    }));

    dump(mailLabelsByName);

    header('Create labels that do not exist');

    await Promise.all(Object.keys(contactGroupsByName).map(async function (name) {
        if (!mailLabelsByName[name]) {
            log('Creating: ', name);

            let labelPayload = { name }
            let { data: { id: newLabelId } } = await gmail.users.labels.create({ userId: 'me', requestBody: labelPayload });

            mailLabelsById[newLabelId] = name;
            mailLabelsByName[name] = newLabelId;
        }
    }));

    header('Get all managed mail filters');

    const { data: { filter: allfilters } } = await gmail.users.settings.filters.list({ userId: 'me' });
    const managedFilters = allfilters.filter(filter => {
        let labelArray = _get(filter, 'action.addLabelIds');
        if (!labelArray) { return false; }
        for (const labelId of labelArray) {
            if (mailLabelsById[labelId]) {
                return true;
            }
        }
    });

    dump(managedFilters);

    header('Delete all managed filters');

    for (const filter of managedFilters) {
        log('Deleting: ', filter.criteria);

        await gmail.users.settings.filters.delete({ userId: 'me', id: filter.id });
    }

    header('Create new filters based on contact groups');

    // this can't be done in parallel
    for (const groupName in contactGroupsByName) {
        if (contactGroupsByName.hasOwnProperty(groupName)) {
            log('Creating: ', groupName);

            const group = contactGroupsByName[groupName];

            let filterPayload = {
                criteria: {
                    from: '{' + group.emails.join(' ') + '}',
                    //to: string,
                    //subject: string,
                    //query: string,
                    //negatedQuery: string,
                    //hasAttachment: boolean,
                    //excludeChats: boolean,
                    //size: integer,
                    //sizeComparison: string
                },
                action: {
                    addLabelIds: [mailLabelsByName[groupName]],
                    removeLabelIds: ['SPAM'],
                    //forward: string
                }
            }

            if (group.emails.length) {
                let response = await gmail.users.settings.filters.create({ userId: 'me', requestBody: filterPayload });
                dump(response);
            } else {
                log('Skipped: Group Empty');
            }
        }
    }

}