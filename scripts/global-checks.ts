import { Octokit } from "@octokit/rest";
import { mkdirp } from "fs-extra";
import simpleGit from "simple-git";
import { readFile, rm } from "fs/promises";
import { execSync } from "child_process";
const config = {
	upstream: {
		owner:  "abalabahaha",
		repo:   "eris",
		branch: "dev"
	},
	self: {
		owner: "ErisPRUpdateBot",
		repo:  "eris"
	},
	user:  "ErisPRUpdateBot",
	token: "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"
};
const octo = new Octokit({ auth: config.token });
const { pathname: workingDir } = new URL("../run", import.meta.url);
await rm(workingDir, { force: true, recursive: true });
await mkdirp(workingDir);
const git = simpleGit(workingDir);
await git
	.init()
	.addRemote("self", `https://github.com/${config.self.owner}/${config.self.repo}`)
	.addRemote("upstream", `https://github.com/${config.upstream.owner}/${config.upstream.repo}`)
	.fetch("upstream", config.upstream.branch);
execSync(`git config --local credential.helper '!f() { sleep 1; echo "username=${config.user}"; echo "password=${config.token}"; }; f'`, {
	cwd: workingDir
});

const { data: pulls } = await octo.request("GET /repos/{owner}/{repo}/pulls", {
	owner: config.upstream.owner,
	repo:  config.upstream.repo,
	state: "open"
});
const exclusions = (await readFile(new URL("../exclusions", import.meta.url))).toString().split("\n").filter(line => !!line && !line.startsWith("#")).map(n => n.toLowerCase());
const { data: upstreamCommits } = await octo.request("GET /repos/{owner}/{repo}/commits", {
	owner:    config.upstream.owner,
	repo:     config.upstream.repo,
	sha:      config.upstream.branch,
	per_page: 100
});

const upstreamLatest = upstreamCommits[0].sha;
for (const pr of pulls) {
	try {
		if (pr.user === null || !pr.user.login) {
			console.log("Skipping PR #%d (%s) due to user not being present", pr.number, pr.html_url);
			continue;
		}
		if (exclusions.includes(pr.user.login.toLowerCase())) {
			console.log("Skipping PR #%d (%s) due to author (%s) being in exclusions list.", pr.number, pr.html_url, pr.user.login);
			continue;
		}
		// console.log(pr.html_url, pr.state, pr.user?.login);

		const { data: commits } = await octo.request("GET /repos/{owner}/{repo}/commits", {
			owner:    pr.head.repo.owner.login,
			repo:     pr.head.repo.name,
			sha:      pr.head.ref,
			per_page: 100
		});
		const hashes = commits.map(c => c.sha);
		if (hashes.includes(upstreamLatest)) {
			console.log("PR #%d is up to date", pr.number);
			continue;
		}
		let behindBy = 0, lastSeen = "";
		upstreamCommits.forEach(c => {
			if (lastSeen) return;
			if (!hashes.includes(c.sha)) behindBy++;
			else lastSeen = c.sha;
		});
		const remoteName = pr.head.repo.owner.login.toLowerCase();
		const prBranch = `${remoteName}/${pr.head.ref}`;
		console.log("PR #%d is behind by %s commit%s%s", pr.number, behindBy >= 100 ? "100+" : behindBy, behindBy === 1 ? "" : "s", !lastSeen ? "" : ` (${lastSeen})`);
		const current = await octo.request("GET /repos/{owner}/{repo}/commits", {
			owner:    config.self.owner,
			repo:     config.self.repo,
			sha:      prBranch,
			per_page: 100
		}).catch(() => null);
		let change = false;
		if (!(current !== null && current.data.map(c => c.sha).includes(upstreamLatest))) {
			const r = await git.getRemotes();
			if (!r.map(f => f.name).includes(remoteName)) await git.addRemote(remoteName, `https://github.com/${pr.head.repo.owner.login}/${pr.head.repo.name}`);
			await git.fetch(remoteName, pr.head.ref);
			await git.checkout(`${remoteName}/${pr.head.ref}`);
			await git.fetch("upstream", `${config.upstream.branch}:${prBranch}`);
			await git.checkout(prBranch);
			await git.push("self", prBranch);
			change = true;
		} else console.log("Skipping branch for PR #%d (%s) as one already exists (%s), and is up to date", pr.number, pr.html_url, prBranch);

		const { data: currentPulls } = await octo.request("GET /repos/{owner}/{repo}/pulls", {
			owner: pr.head.repo.owner.login,
			repo:  pr.head.repo.name
		});
		const cur = currentPulls.find(p =>  p.head.label === `${config.self.owner}:${prBranch}`);
		if (cur && !(cur.state === "closed" && change)) {
			console.log("Pull request for PR #%d (%s) already exists (#%d, %s), skipping..", pr.number, pr.html_url, cur.number, cur.html_url);
			continue;
		} else {
			const { data: pull } = await octo.request("POST /repos/{owner}/{repo}/pulls", {
				owner:                 pr.head.repo.owner.login,
				repo:                  pr.head.repo.name,
				title:                 "Upstream Update",
				head:                  `${config.self.owner}:${prBranch}`,
				base:                  pr.head.ref,
				maintainer_can_modify: true,
				body:                  ""
			});
			console.log("Created pull request for PR #%d (%s): #%d (%s)", pr.number, pr.html_url, pull.number, pull.html_url);
		}
	} catch (err) {
		console.error("Failed To Process PR #%d (%s):", pr.number, pr.html_url, err);
	}
}
