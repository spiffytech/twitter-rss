import axios from "axios";
import * as dotenv from "dotenv";
import * as Hapi from '@hapi/hapi';
import * as nconf from "nconf";
import * as NodeCache from 'node-cache';
import * as RSS from 'rss';
import * as Twitter from 'twitter';

dotenv.config();

nconf.env().required(["twitter_consumer_key", "twitter_consumer_secret"]);

const cache = new NodeCache();

async function getBearerToken() {
    const tokenUrl = "https://api.twitter.com/oauth2/token";
    const encodedCredentials = Buffer.from(
    `${nconf.get("twitter_consumer_key")}:${nconf.get("twitter_consumer_secret")}`
    ).toString("base64");

    const response = await axios.post(tokenUrl, "grant_type=client_credentials", {
    headers: {
        Authorization: `Basic ${encodedCredentials}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    }
    });

    return response.data.access_token;
}

async function getTwitter() {
    const bearer = await getBearerToken();
    const twitter = new Twitter({
        consumer_key: nconf.get('twitter_consumer_key'),
        consumer_secret: nconf.get('twitter_consumer_secret'),
        bearer_token: bearer
    });
    return twitter;
}

async function main() {
    const twitter = await getTwitter();

    const server = new Hapi.Server({
        port: process.env.PORT || 3000,
        host: '0.0.0.0',
        state: {
            ignoreErrors: true
        }
    });

    server.route({
        method: 'GET',
        path: '/feed/{screen_name}',
        handler: async (request) => {
            console.log('here');
            const response = await twitter.get('statuses/user_timeline.json', {screen_name: request.params.screen_name, tweet_mode: 'extended'});

            console.log(response);
            response.forEach(tweet => console.log(tweet.entities.hashtags));

            const feed = new RSS({
                title: `Twitter @${request.params.screen_name}`,
                feed_url: null,
                site_url: null,
                ttl: 1000 * 60 * 15
            });

            response.forEach(tweet => feed.item({
                title: null,
                date: tweet.created_at,
                description: tweet.retweeted_status ? '🔁' + tweet.retweeted_status.full_text : tweet.full_text,
                guid: tweet.id_str,
                url: `http://twitter.com/${request.params.screen_name}/status/${tweet.id_str}`,
                categories: tweet.entities.hashtags.map(hashtag => hashtag.text)
            }));

            return feed.xml({indent: true});
        }
    });

    await server.start();
    console.log('Server running on %s', server.info.uri);
}

main();