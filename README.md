## Eris PR Update Bot
This repository is completely automated. It currently contains 2 scripts. They are all ran through the user [@ErisPRUpdateBot](https://github.com/ErisPRUpdateBot)

## Check For Updates
[![Check For Updates](https://github.com/DonovanDMC/ErisPRUpdateBot/actions/workflows/check-for-updates.yml/badge.svg?branch=master)](https://github.com/DonovanDMC/ErisPRUpdateBot/actions/workflows/check-for-updates.yml)

This script checks my custom branches, like [everything](https://github.com/DonovanDMC/eris/tree/everything) for updates from the pull requsts that are included in it.

## Outdated PR Check
[![Outdated PR Check](https://github.com/DonovanDMC/ErisPRUpdateBot/actions/workflows/outdated-pr-check.yml/badge.svg?branch=master)](https://github.com/DonovanDMC/ErisPRUpdateBot/actions/workflows/outdated-pr-check.yml)

This script checks through all of the current pull requests in the [eris](http://github.com/abalabahaha/eris/pulls) repository, and makes a pull request to update them if they are behind [dev](http://github.com/abalabahaha/eris/tree/dev). You can opt out of this by opening an issue [here](https://github.com/DonovanDMC/ErisPRUpdateBot/issues/new?assignees=DonovanDMC&labels=&template=exclude-from-automatic-pr-creation.md&title=Automatic+PR+Creation+Exclusion+Request). Note that if you close a pull request, a new one will be created if new commits are added to [dev](http://github.com/abalabahaha/eris/tree/dev).
