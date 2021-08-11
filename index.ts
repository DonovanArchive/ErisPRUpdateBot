import { execSync } from "child_process";
import * as fs from "fs-extra";
import YAML from "yaml";
import crypto from "crypto";
import simpleGit from "simple-git/promise";
import fetch from "node-fetch";
import { Octokit } from "@octokit/core";
import { brotliDecompressSync } from "zlib";
const jobId = crypto.randomBytes(16).toString("hex");
const wDir = `${__dirname}/run/${jobId}`;
fs.removeSync(`${__dirname}/run`); // @FIXME
fs.mkdirpSync(wDir);
const config = YAML.parse(fs.readFileSync(`${__dirname}/config.yml`).toString()) as {
	branches: Record<string, Array<Record<"name" | "branch" | "remote", string>>>;
	remotes: Record<string, string> & { origin: string; };
};

const ORIGIN_USER = config.remotes.origin.split("/").slice(-2)[0];
if(!process.env.GITHUB_USER) throw new Error("Missing GITHUB_USER env variable");
if(!process.env.GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN env variable");

const octo = new Octokit({ auth: process.env.GITHUB_TOKEN });

process.nextTick(async() => {
	const b = Object.entries(config.branches);
	const r = Object.entries(config.remotes);

	// setup
	const git = simpleGit(wDir);

	// clone
	await git.clone(config.remotes.origin, ".");
	execSync(`git config --local credential.helper '!f() { sleep 1; echo "username=${process.env.GITHUB_USER}"; echo "password=${process.env.GITHUB_TOKEN}"; }; f'`, {
		cwd: wDir
	});

	// override it
	await git.removeRemote("origin");
	// add remotes
	for(const [name, url] of r) await git.addRemote(name, url/* `https://${config.auth.user}:${config.auth.token}@${url.slice(8)}` */);

	const pulls = await octo.request("GET /repos/{owner}/{repo}/pulls", {
		owner: ORIGIN_USER,
		repo: "eris"
	});

	const prRefList = pulls.data.map(d => d.head.ref);

	// loop branches
	for(const [branch, refs] of b) {
	console.log(`Checking the branch "${branch}"`);
	let outdated = false, currentRef = "unknown";
		try {
			// checkout branch
			await git.fetch("origin", branch);
			await git.checkout(branch);
			
			// get local commits
			const log = await git.log();
			const hashes = log.all.map(c => c.hash);
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
				const prBranch = `${remote}/${refBranch}/${branch}/${hash}`;
				// check if latest commit is included in local commits
				if(!hashes.includes(hash)) {
					outdated = true;
					// check if one of the pull request branches matches our current
					if(prRefList.includes(prBranch)) {
						console.log(`Ref "${name}" is outdated, but a pull request was already found.`);
						continue;
					} else console.log(`Ref "${name}" is outdated, ${remote}/${refBranch} contains hash not included in local: ${hash}`);
					

					await git.fetch(remote, `${refBranch}:${prBranch}`);
					await git.checkout(prBranch);
					await git.push("self", prBranch);
					const pr = await octo.request("POST /repos/{owner}/{repo}/pulls", {
							owner: ORIGIN_USER,
							repo: "eris",
							title: `Remote Update (${branch}): ${remote}/${refBranch}`,
							head: `${process.env.GITHUB_USER}:${prBranch}`,
							base: branch,
							maintainer_can_modify: true
					});
					console.log(`Created pull request for "${name}", ${pr.data.html_url}`);
					// get all remote commits
					const branchLog = await git.log([`${remote}/${refBranch}`]);
					const branchHashes = branchLog.all.map(c => c.hash);
					
					// check for pull requests with a branch of one of our commit hashes
					// (new commits since last)
					const prDupRef = prRefList.find(r => branchHashes.some(h => r.endsWith(`${branch}/${h}`)));
					if(prDupRef) {
						const oldPr = pulls.data.find(p => p.head.ref === prDupRef)!.number;
						console.log(`(${remote}/${refBranch}) Closing old pull request #${oldPr}`);
						await octo.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
							owner: ORIGIN_USER,
							repo: "eris",
							issue_number: oldPr,
							body: `This pull request has been superseded by #${pr.data.number}`
						});
						await octo.request("PATCH /repos/{owner}/{repo}/pulls/{pull_number}", {
							owner: ORIGIN_USER,
							repo: "eris",
							pull_number: oldPr,
							state: "closed"
						});
						await git.push(["self", "--delete", prDupRef]).catch(() => null);
					}
				} else console.log(`Ref "${name}" is up-to-date, hash: ${hash}`);
			}
		} catch(err) {
			console.log(`Error updating "${currentRef}"`, err);
		}

		console.log(`Done processing branch "${branch}", ${outdated ? "" : "no "}changes were found`);
	}
});
