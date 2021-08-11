import { execSync } from "child_process";
import * as fs from "fs-extra";
import YAML from "yaml";
import crypto from "crypto";
import simpleGit from "simple-git/promise";
import fetch from "node-fetch";
import { Octokit } from "@octokit/core";
import { createTokenAuth } from "@octokit/auth-token";
const jobId = crypto.randomBytes(16).toString("hex");
const wDir = `${__dirname}/run/${jobId}`;
fs.removeSync(`${__dirname}/run`); // @FIXME
fs.mkdirpSync(wDir);
const config = YAML.parse(fs.readFileSync(`${__dirname}/config.yml`).toString()) as {
	branches: Record<string, Array<Record<"name" | "branch" | "remote", string>>>;
	remotes: Record<string, string> & { origin: string; };
};

if(!fs.existsSync(`${__dirname}/token`)) throw new Error("Missing token file.");

const USER = "ErisPRUpdateBot";
const TOKEN = fs.readFileSync(`${__dirname}/token`).toString();

const octo = new Octokit({ auth: TOKEN });

process.nextTick(async() => {
	const b = Object.entries(config.branches);
	const r = Object.entries(config.remotes);

	// setup
	const git = simpleGit(wDir);

	// clone
	await git.clone(config.remotes.origin, ".");
	execSync(`git config --local credential.helper '!f() { sleep 1; echo "username=${USER}"; echo "password=${TOKEN}"; }; f'`, {
		cwd: wDir
	});

	// override it
	await git.removeRemote("origin");
	// add remotes
	for(const [name, url] of r) await git.addRemote(name, url/* `https://${config.auth.user}:${config.auth.token}@${url.slice(8)}` */);

	// get local commits
	const log = await git.log();
	const hashes = log.all.map(c => c.hash);

	// loop branches
	for(const [branch, refs] of b) {
	console.log(`Checking the branch "${branch}"`);
	let outdated = false, currentRef = "unknown";
		try {
			// checkout branch
			await git.fetch("origin", branch);
			await git.checkout(branch);
			// await git.branch(["-m", jobId]);

			// loop remotes
			for(const { name, branch: refBranch, remote } of refs) {
				currentRef = refBranch;
				// bring remote branch to local
				await git.fetch(remote, refBranch);
				// get remote commits
				const ls = await git.listRemote([remote, "-h", refBranch]);
				// slice off last part of ls-remote
				const hash = ls.toString().slice(0, 40);
				// check if latest commit is included in local commits
				if(!hashes.includes(hash)) {
					outdated = true;
					console.log(`Ref "${name}" is outdated, ${remote}/${branch} contains hash not included in local: ${hash}`);
					await git.fetch(remote, `${refBranch}:update/${remote}/${refBranch}/${jobId}`);
					await git.push("self", `update/${remote}/${refBranch}/${jobId}`);
					const pr = await octo.request("POST /repos/{owner}/{repo}/pulls", {
						owner: config.remotes.origin.split("/").slice(-2)[0],
						repo: config.remotes.origin.split("/").slice(-1)[0],
						title: `Remote Update (${branch}): ${remote}/${refBranch}`,
						head: `${config.remotes.self.replace(/(https?:\/\/)?(\w:\w)?github.com\//, "").split("/").slice(-2, -1)[0]}:update/${remote}/${refBranch}/${jobId}`,
						base: branch,
						maintainer_can_modify: true,
						request: {
							hook: createTokenAuth(TOKEN).hook
						}
					});
					console.log(`Created pull request for "${name}", ${pr.data.html_url}`);
				} else console.log(`Ref "${name}" is up-to-date, hash: ${hash}`);
			}
		} catch(err) {
			console.log(`Error updating "${currentRef}"`, err);
		}

		console.log(`Done processing for branch "${branch}", ${outdated ? "" : "no "}changes were found`);
	}
});
