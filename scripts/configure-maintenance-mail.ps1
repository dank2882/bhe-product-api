# Approved by Dan: read/send only maintenance@foundedonfaith.com.
# Uses Exchange Application RBAC, not tenant-wide Entra Mail grants.
$ErrorActionPreference = 'Stop'
$maintenanceApp = '97aca4e1-1d64-4b8c-8fd1-ba5737e9f120'
$maintenancePrincipal = '8594f3a9-2d9d-49c4-9033-b514d34f74fa'
$maintenanceScope = 'FBC Maintenance Mailbox Only'
$maintenanceFilter = "PrimarySmtpAddress -eq 'maintenance@foundedonfaith.com'"
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -UserPrincipalName 'dank@foundedonfaith.com' -DisableWAM -ShowBanner:$false
$connection = Get-ConnectionInformation | Where-Object { $_.UserPrincipalName -eq 'dank@foundedonfaith.com' -and $_.State -eq 'Connected' }
if (-not $connection) { throw 'Expected Dan individual Exchange connection.' }
$recipients = @(Get-Recipient -Filter $maintenanceFilter)
if ($recipients.Count -ne 1 -or $recipients[0].PrimarySmtpAddress.ToString() -ne 'maintenance@foundedonfaith.com') { throw 'Mailbox scope did not resolve to exactly Maintenance.' }
$scope = Get-ManagementScope | Where-Object Name -eq $maintenanceScope
if (-not $scope) {
  New-ManagementScope -Name $maintenanceScope -RecipientRestrictionFilter $maintenanceFilter | Out-Null
} elseif ($scope.RecipientFilter -notmatch "PrimarySmtpAddress -eq 'maintenance@foundedonfaith.com'") {
  throw 'Existing scope differs; inspect before changing.'
}
$principal = Get-ServicePrincipal | Where-Object AppId -eq $maintenanceApp
if (-not $principal) {
  New-ServicePrincipal -AppId $maintenanceApp -ObjectId $maintenancePrincipal -DisplayName 'FBC Maintenance Mail Worker' | Out-Null
} elseif ($principal.ObjectId -ne $maintenancePrincipal) { throw 'Existing service principal mismatch.' }
foreach ($entry in @(@('FBC Maintenance Mail Read', 'Application Mail.Read'), @('FBC Maintenance Mail Send', 'Application Mail.Send'))) {
  $assignment = Get-ManagementRoleAssignment -Identity $entry[0] -ErrorAction SilentlyContinue
  if (-not $assignment) {
    New-ManagementRoleAssignment -Name $entry[0] -Role $entry[1] -App $maintenancePrincipal -CustomResourceScope $maintenanceScope | Out-Null
  } elseif ($assignment.CustomResourceScope -ne $maintenanceScope -or $assignment.Role.ToString() -ne $entry[1]) {
    throw 'Existing assignment differs; inspect before changing.'
  }
}
$allowed = @(Test-ServicePrincipalAuthorization -Identity $maintenancePrincipal -Resource 'maintenance@foundedonfaith.com')
$denied = @(Test-ServicePrincipalAuthorization -Identity $maintenancePrincipal -Resource 'dank@foundedonfaith.com')
if (@($allowed | Where-Object InScope -eq $true).Count -ne 2) { throw 'Maintenance mailbox allow check failed.' }
if (@($denied | Where-Object InScope -eq $true).Count -ne 0) { throw 'Unrelated mailbox deny check failed.' }
[ordered]@{ applicationId=$maintenanceApp; servicePrincipalId=$maintenancePrincipal; mailbox='maintenance@foundedonfaith.com'; allowed=$allowed | Select-Object RoleName,InScope; unrelatedMailboxDenied=($denied | Select-Object RoleName,InScope); verifiedAt=(Get-Date).ToUniversalTime().ToString('o'); note='RBAC checks exclude additive Entra grants; verify those separately and perform live Graph acceptance.' } | ConvertTo-Json -Depth 5
Disconnect-ExchangeOnline -Confirm:$false
