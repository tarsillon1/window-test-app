param ([string]$processName)
function GetProcessInfoByName
{
    Get-WmiObject -class Win32_PerfFormattedData_PerfProc_Process | where{$_.name -like $processName+"*"} | select `
    @{Name="ID"; Expression = {Get-WmiObject Win32_Process -Filter ("ProcessID = "+$_.IDProcess) | Select-Object CommandLine}} ,`
    @{Name="Private Working Set"; Expression = {$_.workingSetPrivate / 1kb}}
    @{Name="Working Set"; Expression = {$_.workingSet / 1kb}}
}

$FormatEnumerationLimit=-1
GetProcessInfoByName | Format-Table -Property * -AutoSize | Out-String -Width 4096;