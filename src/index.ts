import axios from "axios";
import * as dotenv from "dotenv";
import * as Hapi from "@hapi/hapi";
import * as Inert from "@hapi/inert";
import nconf from "nconf";
import NodeCache from "node-cache";
import RSS from "rss";
import Twitter from "twitter";

dotenv.config();

nconf.env().required(["twitter_consumer_key", "twitter_consumer_secret"]);

const cache = new NodeCache({ stdTTL: 60 * 15 });

async function getBearerToken() {
  const tokenUrl = "https://api.twitter.com/oauth2/token";
  const encodedCredentials = Buffer.from(
    `${nconf.get("twitter_consumer_key")}:${nconf.get(
      "twitter_consumer_secret"
    )}`
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
    consumer_key: nconf.get("twitter_consumer_key"),
    consumer_secret: nconf.get("twitter_consumer_secret"),
    bearer_token: bearer
  });
  return twitter;
}

async function getUserTimeline(twitter: Twitter, screen_name: string) {
  const timeline = await twitter.get("statuses/user_timeline.json", {
    screen_name: screen_name,
    tweet_mode: "extended",
    count: 200
  });
  return Promise.all(
    timeline.map(async (tweet: any) => {
      let preceding_tweet = null;
      if (tweet.in_reply_to_status_id_str) {
        console.log("here");
        try {
          preceding_tweet = await twitter.get(
            `statuses/show/${tweet.in_reply_to_status_id_str}`,
            { tweet_mode: "extended" }
          );
        } catch (ex) {
          // Protected tweets, deleted tweets
          if (ex.find((err: any) => [144, 179].includes(err.code))) {
            return tweet;
          }

          // Twitter API throws an array of objects. Hapi can't handle
          // that and will swallow the errors.
          console.error(ex);
          throw ex;
        }
      }

      return { ...tweet, preceding_tweet };
    })
  );
}

async function main() {
  const twitter = await getTwitter();

  const server = new Hapi.Server({
    port: process.env.PORT || 3000,
    host: "0.0.0.0",
    state: {
      ignoreErrors: true
    }
  });

  await server.register(Inert);

  server.route({
    method: "GET",
    path: "/feed/{screen_name}",
    handler: async request => {
      const cachedTimeline: Twitter.ResponseData | undefined = cache.get(
        request.params.screen_name
      );
      const timeline: Twitter.ResponseData = cachedTimeline
        ? cachedTimeline
        : await getUserTimeline(twitter, request.params.screen_name);
      if (!cachedTimeline) cache.set(request.params.screen_name, timeline);

      console.log(timeline);

      const feed = new RSS({
        title: `Twitter @${request.params.screen_name}`,
        feed_url: "",
        site_url: "",
        ttl: 15
      });

      function prependRetweetSymbol(tweet: any) {
        return tweet.retweeted_status
          ? "🔁" + tweet.retweeted_status.full_text
          : tweet.full_text;
      }

      timeline.forEach((tweet: any) => {
        let itemBody: string | null = null;
        if (tweet.preceding_tweet) {
          itemBody = `@${tweet.preceding_tweet.user.screen_name}
                        <blockquote>${
                          tweet.preceding_tweet.full_text
                        }</blockquote>
                        ${prependRetweetSymbol(tweet)}
                    `;
        } else {
          itemBody = prependRetweetSymbol(tweet);
        }

        feed.item({
          title: "",
          date: tweet.created_at,
          description: itemBody!,
          guid: tweet.id_str,
          url: `http://twitter.com/${request.params.screen_name}/status/${tweet.id_str}`,
          categories: tweet.entities.hashtags.map(
            (hashtag: any) => hashtag.text
          )
        });
      });

      return feed.xml({ indent: true });
    }
  });

  server.route({
    method: "GET",
    path: "/{param*}",
    handler: {
      directory: {
        path: "./public",
        index: ["index.html"]
      }
    }
  });

  await server.start();
  console.log("Server running on %s", server.info.uri);
}

main();
