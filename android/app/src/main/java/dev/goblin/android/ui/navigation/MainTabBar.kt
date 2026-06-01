package dev.goblin.android.ui.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

enum class MainTab {
    Hosts,
    Projects,
}

internal fun shouldSwitchMainTab(current: MainTab, target: MainTab): Boolean = current != target

@Composable
fun MainTabBar(
    selected: MainTab,
    onSelect: (MainTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    NavigationBar(modifier = modifier) {
        MainTab.entries.forEach { tab ->
            NavigationBarItem(
                selected = selected == tab,
                onClick = {
                    if (shouldSwitchMainTab(selected, tab)) {
                        onSelect(tab)
                    }
                },
                icon = {
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .semantics { contentDescription = tab.label },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = tab.shortLabel,
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                },
                label = { Text(tab.label) },
                alwaysShowLabel = true,
            )
        }
    }
}

private val MainTab.label: String
    get() = when (this) {
        MainTab.Hosts -> "Hosts"
        MainTab.Projects -> "Projects"
    }

private val MainTab.shortLabel: String
    get() = when (this) {
        MainTab.Hosts -> "H"
        MainTab.Projects -> "P"
    }
